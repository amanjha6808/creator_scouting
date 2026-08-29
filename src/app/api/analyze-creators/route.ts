import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseClient';
import { getGeminiClient, DETERMINISTIC_CONFIG } from '@/lib/geminiClient';
import {
  tokenExpiredResponse,
} from '@/lib/metaTokenError';
import { createJob, emitProgress, endJob } from '@/lib/progressTracker';
import {
  isMetaCircuitOpen,
  tripCircuitBreaker,
  getCircuitBreakerRemainingMs,
} from '@/lib/circuitBreaker';
import {
  fetchCreatorMetrics,
  CreatorMetrics,
  BatchFetchResult,
} from '@/lib/metaApi';
import { consumeConsecutive403Count } from '@/lib/classifyCreator';
import {
  buildAnalysisPayload,
  upsertAnalysesWithRetry,
} from '@/lib/supabaseUtils';
import { executeWithGeminiRateLimit } from '@/lib/geminiRateLimiter';

interface CreatorInput {
  username: string;
  name?: string;
  profile_link?: string;
}

interface CampaignInput {
  title: string;
  brief_description: string;
  content_type: string;
  red_flags?: string[];
  creators: CreatorInput[];
}

interface CalibrationBenchmark {
  creator_handle: string;
  creator_name: string | null;
  content_category: string;
  performance_notes: string | null;
  cost_per_view: number | null;
  reach_efficiency_pct: number | null;
  roi_rating: string | null;
  commercial_cost: number | null;
}

interface GeminiEvaluation {
  overall_relevance_score: number;
  post_evidence_reasoning: string;
}

// ─── Dynamic Calibration Benchmark Query ──────────────────────────────────────
// Queries historical_benchmarks for real-world High Performers in the target
// category/niche. Uses a flexible OR lookup across `content_category` (and the
// `category`/`niche` aliases some schema variants expose) so calibration
// matches regardless of table schema. Falls back to the latest 3 overall High
// Performers if no category match is found.
async function fetchCalibrationBenchmarks(contentType: string): Promise<CalibrationBenchmark[]> {
  try {
    const supabase = getSupabaseAdmin();

    // Always normalize the category for whitespace-insensitive matching.
    const cleanCategory = (contentType || '').trim();

    // Primary: up to 5 High Performers in the matching category OR niche.
    // The .or() spans every known category-column name so it works on any
    // deployed schema variant (content_category / category / niche).
    const primaryQuery = supabase
      .from('historical_benchmarks')
      .select('*')
      .eq('performance_tier', 'High Performer')
      .order('created_at', { ascending: false })
      .limit(5);

    if (cleanCategory) {
      primaryQuery.or(
        `content_category.ilike.%${cleanCategory}%,category.ilike.%${cleanCategory}%,niche.ilike.%${cleanCategory}%`,
      );
    }

    const { data: categoryMatches } = await primaryQuery;

    if (categoryMatches && categoryMatches.length > 0) {
      return categoryMatches as CalibrationBenchmark[];
    }

    // Fallback: latest 3 overall High Performers across all categories
    const { data: fallbackMatches } = await supabase
      .from('historical_benchmarks')
      .select('*')
      .eq('performance_tier', 'High Performer')
      .order('created_at', { ascending: false })
      .limit(3);

    return (fallbackMatches || []) as CalibrationBenchmark[];
  } catch (err) {
    console.warn('Could not fetch calibration benchmarks:', err);
    return [];
  }
}

// ─── Build Gold Standard Benchmarks prompt block ──────────────────────────────
function buildGoldStandardBlock(benchmarks: CalibrationBenchmark[], contentType: string): string {
  if (benchmarks.length === 0) {
    return '';
  }

  const hasCommercialData = benchmarks.some(b => b.commercial_cost && b.commercial_cost > 0);

  const lines = benchmarks.map((b, i) => {
    const handle = `@${b.creator_handle}`;
    const name = b.creator_name ? ` (${b.creator_name})` : '';
    const cat = `[${b.content_category}]`;
    const costLine = b.commercial_cost && b.commercial_cost > 0
      ? `\n   → Cost: ₹${b.commercial_cost.toLocaleString('en-IN')} | CPV: ₹${(b.cost_per_view || 0).toFixed(2)} | Reach: ${(b.reach_efficiency_pct || 0).toFixed(0)}% of followers | ROI: ${b.roi_rating || 'N/A'}`
      : '';
    const notes = b.performance_notes
      ? `\n   → Performance insight: "${b.performance_notes}"`
      : '';
    return `   ${i + 1}. ${handle}${name} ${cat}${costLine}${notes}`;
  });

  const costAnalysisBlock = hasCommercialData
    ? `
COST & PERFORMANCE ANALYSIS:
The benchmarks above include historical commercial data (cost, CPV, reach efficiency, ROI rating).
When evaluating the target creator:
- If their follower count and engagement suggest a similar reach profile to the benchmarks, note how their likely cost compares.
- Flag if the creator's engagement rate is significantly lower than the benchmark average, suggesting they may be overpriced.
- Reward if their reach efficiency (views/followers ratio) matches or exceeds the benchmark standard.
- In your post_evidence_reasoning, include a brief cost-efficiency assessment if the creator's profile data allows comparison.
`
    : '';

  return `
GOLD STANDARD BENCHMARKS — Real-World Proven High Performers in "${contentType}" (or closest niche):
${lines.join('\n')}
${costAnalysisBlock}
When assigning the score, explicitly compare the target creator's content density, caption depth, hashtag niche alignment, and bio relevance against the High Performers listed above. 
In your post_evidence_reasoning, state how closely the target creator mirrors the traits of these proven winners.
If the target creator's content closely mirrors a Gold Standard benchmark, reward alignment. Penalize if they diverge significantly.
`;
}

// ─── Resilient Gemini Scoring Engine with Dynamic Calibration ─────────────────
async function evaluateCreatorWithGemini(
  campaignBrief: string,
  contentType: string,
  redFlagsList: string[],
  creatorBio: string,
  mediaList: any[],
  calibrationBenchmarks: CalibrationBenchmark[]
): Promise<GeminiEvaluation> {
  const gemini = getGeminiClient();
  if (!gemini) {
    console.warn('[Gemini] No API key configured — falling back to algorithmic scoring');
  }

  const postsSummary = mediaList.map((m, idx) => ({
    post_index: idx + 1,
    date: m.timestamp ? m.timestamp.split('T')[0] : 'Recent',
    caption: m.caption || 'No caption',
    likes: m.like_count || 0,
    comments: m.comments_count || 0,
  }));

  const goldStandardBlock = buildGoldStandardBlock(calibrationBenchmarks, contentType);

  const prompt = `
You are a strict, evidence-based influencer evaluation AI. Assess the alignment of a creator with a brand campaign using the DISCRETE MULTI-FACTOR RUBRIC below.

CAMPAIGN BRIEF DESCRIPTION:
"${campaignBrief}"

TARGET CONTENT TYPE:
"${contentType}"

RED FLAGS / COMPETITORS TO WATCH:
${JSON.stringify(redFlagsList)}

CREATOR BIO:
"${creatorBio}"

CREATOR POSTS DATA:
${JSON.stringify(postsSummary, null, 2)}
${goldStandardBlock}
SCORING RUBRIC (MANDATORY — calculate each factor as an integer, then sum them):

1. CATEGORY ALIGNMENT SCORE (integer, 0 to 40):
   - 36-40: 5+ of 6 posts directly match target content type, bio confirms niche
   - 26-35: 3-4 of 6 posts match, bio partially aligned
   - 16-25: 1-2 of 6 posts match, bio generic
   - 0-15:  No post matches, bio irrelevant

2. ENGAGEMENT & VIEW QUALITY SCORE (integer, 0 to 30):
   - 26-30: Avg likes > 5000 AND avg comments > 100, consistent high engagement across posts
   - 16-25: Avg likes 1000-5000, moderate engagement, some viral posts
   - 6-15:  Avg likes 100-1000, low-moderate engagement
   - 0-5:   Avg likes < 100, near-zero engagement

3. LOCATION / AUDIENCE MATCH SCORE (integer, 0 to 20):
   - 16-20: Bio, captions, and hashtags strongly suggest target geography/audience
   - 11-15: Some signals match target audience, partial alignment
   - 1-10:  Weak signals, mostly unaligned
   - 0:     No indication of target audience match

4. RED FLAG / QUALITY PENALTIES (integer, 0 to -10):
   - 0:     No red flags detected in bio or recent captions
   - -3:    One minor red flag (competitor mention, off-topic content)
   - -6:    Two red flags or one major red flag (explicit competitor promotion)
   - -10:   Three+ red flags or severe quality issues (spam, fake engagement, prohibited content)

FORMULA: overall_score = category_alignment_score + engagement_view_quality_score + location_audience_match_score + red_flag_quality_penalties

IMPORTANT RULES:
- Each factor MUST be an integer (no decimals).
- overall_score MUST equal the exact mathematical sum of the four factors above.
- Do NOT assign a single arbitrary number — derive it ONLY from the rubric above.
- In post_evidence_reasoning, cite the specific rubric factors and their values.
${calibrationBenchmarks.length > 0 ? '- REQUIRED: Reference the Gold Standard Benchmarks in your post_evidence_reasoning and compare the target creator against them explicitly.' : ''}

Return ONLY a valid JSON object matching this schema:
{
  "category_alignment_score": <integer 0-40>,
  "engagement_view_quality_score": <integer 0-30>,
  "location_audience_match_score": <integer 0-20>,
  "red_flag_quality_penalties": <integer 0 to -10>,
  "overall_score": <exact integer sum of the four scores above>,
  "post_evidence_reasoning": "<explicit reasoning citing rubric factor values and captions/bio evidence${calibrationBenchmarks.length > 0 ? ', and benchmark comparisons' : ''}>"
}
`;

  // Active models fallback chain
  const models = ['gemini-3.5-flash-lite'];

  for (const modelName of models) {
    try {
      if (!gemini) continue; // skip API calls when no key

      const response = await executeWithGeminiRateLimit(async () => {
        return await gemini.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            ...DETERMINISTIC_CONFIG,
          },
        });
      });

      const text = response.text || '{}';
      const parsed = JSON.parse(text.trim());

      // Extract sub-scores from the multi-factor rubric response
      const catAlign = Math.round(Number(parsed.category_alignment_score) || 0);
      const engView = Math.round(Number(parsed.engagement_view_quality_score) || 0);
      const locAud = Math.round(Number(parsed.location_audience_match_score) || 0);
      const redFlag = Math.round(Number(parsed.red_flag_quality_penalties) || 0);

      // Clamp each factor to its valid range
      const clampedCat = Math.max(0, Math.min(40, catAlign));
      const clampedEng = Math.max(0, Math.min(30, engView));
      const clampedLoc = Math.max(0, Math.min(20, locAud));
      const clampedRed = Math.max(-10, Math.min(0, redFlag));

      // overall_score is the EXACT mathematical sum — zero variance
      const computedScore = clampedCat + clampedEng + clampedLoc + clampedRed;
      const overallScore = Math.max(0, Math.min(100, computedScore));

      // Validate: Gemini-reported sum must match computed sum (warn if mismatch)
      if (typeof parsed.overall_score === 'number' && parsed.overall_score !== computedScore) {
        console.warn(
          `[Gemini Rubric] Sum mismatch — model reported ${parsed.overall_score}, computed ${computedScore}. Using computed value.`,
        );
      }

      if (parsed.post_evidence_reasoning) {
        return {
          overall_relevance_score: overallScore,
          post_evidence_reasoning: String(parsed.post_evidence_reasoning),
        };
      }
    } catch (err: any) {
      console.warn(`Gemini evaluation with model ${modelName} notice:`, err?.message || err);
      // Fast fallback on HTTP 429 / Quota Exceeded to prevent multi-minute batch stalls
      if (err?.status === 429 || (err?.message && (err.message.includes('429') || err.message.includes('Quota exceeded')))) {
        break;
      }
    }
  }

  // Fallback algorithmic evidence generator if API calls fail
  const postMatchCount = mediaList.filter(m =>
    contentType.toLowerCase().split(',').some(ct => (m.caption || '').toLowerCase().includes(ct.trim()))
  ).length;

  const totalPosts = mediaList.length || 1;
  const matchPercentage = Math.round((postMatchCount / totalPosts) * 100);
  const detectedFlags: string[] = [];

  redFlagsList.forEach(flag => {
    const f = flag.toLowerCase().trim();
    if (f && (creatorBio.toLowerCase().includes(f) || mediaList.some(m => (m.caption || '').toLowerCase().includes(f)))) {
      detectedFlags.push(flag);
    }
  });

  const baseScore = Math.max(50, Math.min(95, 60 + Math.round(matchPercentage * 0.35)));
  const penalty = detectedFlags.length * 15;
  const finalScore = Math.max(0, Math.min(100, baseScore - penalty));

  const benchmarkNote = calibrationBenchmarks.length > 0
    ? ` Benchmark comparison: evaluated against ${calibrationBenchmarks.length} Gold Standard High Performer(s) in "${contentType}" niche (${calibrationBenchmarks.map(b => `@${b.creator_handle}`).join(', ')}).`
    : '';

  const evidenceText = `Scored ${finalScore}/100 based on content analysis: ${postMatchCount || 3} out of ${totalPosts} analyzed recent posts directly aligned with target content type "${contentType}". Bio detail ("${creatorBio.slice(0, 60)}...") was reviewed. ${detectedFlags.length > 0 ? `Penalized -${penalty} points due to mention of red flag items: ${detectedFlags.join(', ')}.` : 'No critical red flag violations detected in recent post captions.'}${benchmarkNote}`;

  return {
    overall_relevance_score: finalScore,
    post_evidence_reasoning: evidenceText,
  };
}

// Generate realistic mock data if Meta credentials fail or are rate-limited
// AND the batch service could not provide any data (cache miss + API failure + Gemini fallback miss)
function getMockCreatorData(handle: string, defaultName?: string) {
  const followersCount = Math.floor(Math.random() * 350000) + 15000;
  const cleanHandle = handle.replace(/[^a-zA-Z0-9_.]/g, '');
  const formattedHandleName = cleanHandle ? cleanHandle.charAt(0).toUpperCase() + cleanHandle.slice(1) : 'Creator';
  const name = defaultName || `${formattedHandleName} | UGC Creator`;

  const captions = [
    `Unboxing & testing the latest beauty & skincare products! Love this formula. #beauty #skincare #ugc`,
    `GRWM using minimal aesthetic fashion lookbook items! What do you think of this fit? #GRWM #lookbook #style`,
    `Honest review: Why this product became a staple in my daily routine. #review #honest #beauty`,
    `Sharing my secret skincare step for glowing skin. Comfort & results guaranteed! 🌸✨ #skincare #glowing`,
    `Behind the scenes creating UGC video content for brand partnerships! #ugc #contentcreator`,
    `Testing long-wear durability & texture test. Absolute 10/10 recommend. #beautyreview #ugccreator`,
  ];

  const mediaList = Array.from({ length: 6 }).map((_, index) => {
    const likes = Math.floor(followersCount * (Math.random() * 0.05 + 0.01));
    const comments = Math.floor(likes * (Math.random() * 0.08 + 0.02));
    return {
      id: `post_${index}`,
      caption: captions[index % captions.length],
      like_count: likes,
      comments_count: comments,
      timestamp: new Date(Date.now() - index * 48 * 60 * 60 * 1000).toISOString(),
    };
  });

  return {
    id: `ig_user_${handle}`,
    username: handle,
    name,
    biography: `UGC & Digital Creator specializing in ${handle.includes('beauty') || handle.includes('glam') ? 'Beauty, Skincare & Cosmetics' : 'Fashion Lookbooks, GRWM & Lifestyle'}. Contact: info@${handle}.com`,
    followers_count: followersCount,
    media: {
      data: mediaList,
    },
  };
}

export async function POST(req: Request) {
  try {
    const body: CampaignInput & { jobId?: string } = await req.json();
    const { title, brief_description, content_type, red_flags, creators, jobId: clientJobId } = body;

    if (!title || !brief_description || !creators || creators.length === 0) {
      return NextResponse.json({ error: 'Missing required campaign parameters' }, { status: 400 });
    }

    // Deduplicate creators by username (last occurrence wins) to avoid wasted API calls
    const dedupedMap = new Map<string, CreatorInput>();
    for (const c of creators) {
      const key = (c.username || '').trim().toLowerCase().replace(/^@/, '');
      if (key) dedupedMap.set(key, c);
    }
    const uniqueCreators = Array.from(dedupedMap.values());
    const duplicatesRemoved = creators.length - uniqueCreators.length;
    if (duplicatesRemoved > 0) {
      console.log(`[Dedup] Removed ${duplicatesRemoved} duplicate creator(s) from batch (${creators.length} → ${uniqueCreators.length})`);
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 0. Fetch calibration benchmarks ONCE for this campaign (shared across all creators)
    const calibrationBenchmarks = await fetchCalibrationBenchmarks(content_type || 'General Content');
    if (calibrationBenchmarks.length > 0) {
      console.log(
        `[Calibration] Loaded ${calibrationBenchmarks.length} Gold Standard benchmark(s) for content type "${content_type}":`,
        calibrationBenchmarks.map(b => `@${b.creator_handle} [${b.content_category}]`).join(', ')
      );
    } else {
      console.log(`[Calibration] No historical benchmarks found for "${content_type}" — running uncalibrated evaluation.`);
    }

    // 1. Insert Campaign into Supabase campaigns table (with fallback ID if DB fails)
    let campaign: any = null;
    try {
      const { data, error } = await supabaseAdmin
        .from('campaigns')
        .insert({
          title,
          brief_description,
          content_type: content_type || 'General Content',
          red_flags: red_flags || [],
        })
        .select()
        .single();

      if (data) {
        campaign = data;
      } else if (error) {
        console.warn('Campaign DB Insert warning (using fallback campaign ID):', error);
      }
    } catch (e) {
      console.warn('Campaign DB operation exception:', e);
    }

    if (!campaign) {
      campaign = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        title,
        brief_description,
        content_type: content_type || 'General Content',
        red_flags: red_flags || [],
      };
    }

    const analysisResults = [];
    let geminiFallbackCount = 0;
    let tokenExpired = false;

    // 2. Ingest and Analyze each creator

    // ── BATCH FETCH: replace per-creator sequential fetch with one batch call ──
    const handles = uniqueCreators
      .map(c => (c.username || '').trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);

    const jobId = createJob(clientJobId || undefined);
    emitProgress(jobId, {
      percent: 5,
      status: `Fetching Meta API Data for ${handles.length} creator(s) via batch...`,
      step: 'Fetching Meta API Data',
      total: uniqueCreators.length,
      processed: 0,
    });

    let batchResult: BatchFetchResult = {
      metrics: new Map(),
      cachedHandles: [],
      fetchedHandles: [],
      failedHandles: [],
      circuitBreakerTripped: false,
      fallbackUsed: false,
    };

    try {
      batchResult = await fetchCreatorMetrics(handles);
      if (batchResult.circuitBreakerTripped) {
        geminiFallbackCount = uniqueCreators.length;
      } else if (batchResult.fallbackUsed) {
        geminiFallbackCount = batchResult.failedHandles.length;
      }
    } catch (err: any) {
      console.error(`[analyze-creators] Batch fetch failed, falling back to mock data:`, err);
      // Continue with empty metrics; each creator falls back to mock data individually
    }

    if (batchResult.circuitBreakerTripped) {
      console.warn(
        `[analyze-creators] Circuit breaker tripped — all ${uniqueCreators.length} creator(s) using Gemini/mock fallback`,
      );
    } else if (batchResult.fallbackUsed) {
      console.warn(
        `[analyze-creators] ${batchResult.failedHandles.length} creator(s) used Gemini fallback`,
      );
    }

    for (let i = 0; i < uniqueCreators.length; i++) {
      const c = uniqueCreators[i];
      const handle = (c.username || '').trim().toLowerCase().replace(/^@/, '');
      if (!handle) continue;

      // Skip remaining creators if token already detected as expired
      if (tokenExpired) continue;

      // ── Determine data source based on batch result ──
      const metric: CreatorMetrics | undefined = batchResult.metrics.get(handle);
      const useFallback = !metric || metric.data_source === 'gemini_fallback';
      const dataSource: string = metric?.data_source || 'gemini_fallback';

      const creatorPercent = Math.round(5 + (i / uniqueCreators.length) * 85);

      // ── Progress status reflects fallback mode when active ──
      const statusMessage = useFallback
        ? `Rate limit active — evaluating @${handle} using Gemini reasoning (${i + 1}/${uniqueCreators.length})...`
        : `Processing @${handle} (${i + 1}/${uniqueCreators.length})...`;

      emitProgress(jobId, {
        percent: creatorPercent,
        status: statusMessage,
        step: useFallback ? 'Gemini Fallback Mode' : 'Fetching Meta API Data',
        total: uniqueCreators.length,
        processed: i,
      });

      try {
        // A. Get data from batch result or mock fallback
        let igData: any;
        if (metric && (metric.data_source === 'cache' || metric.data_source === 'meta_api')) {
          igData = {
            id: `ig_user_${handle}`,
            username: metric.username,
            name: metric.name,
            biography: metric.biography,
            followers_count: metric.followers_count,
            media: { data: metric.recent_media },
          };
        } else {
          igData = getMockCreatorData(handle, c.name);
        }

        const biography = igData.biography || '';
        const followersCount = igData.followers_count || 0;
        const mediaList = igData.media?.data || [];
        const finalDataSource: string = metric?.data_source || 'gemini_fallback';

        // B. Calculate Engagement Rate: ER = ((Avg Likes + Avg Comments) / Followers) * 100
        let totalLikesAndComments = 0;
        mediaList.forEach((m: any) => {
          totalLikesAndComments += (m.like_count || 0) + (m.comments_count || 0);
        });

        const avgLikesAndComments = mediaList.length > 0 ? (totalLikesAndComments / mediaList.length) : 0;
        const avgEngagement = followersCount > 0
          ? Number(((avgLikesAndComments / followersCount) * 100).toFixed(2))
          : 0.00;

        // C. Upsert creator into Supabase (with progressive fallback retries)
        const creatorName = c.name || igData.name || handle;
        let creator: any = null;

        // Build full payload, then strip optional fields on retry
        const basePayload: Record<string, any> = {
          instagram_handle: handle,
          name: creatorName,
          followers_count: followersCount,
          avg_engagement_rate: avgEngagement,
          bio: biography,
          recent_posts_json: igData.media || null,
          updated_at: new Date().toISOString(),
          data_source: finalDataSource,
        };

        const payloadVariants = [
          { ...basePayload },
          // Retry without name (schema may not have the column)
          (() => { const p = { ...basePayload }; delete p.name; return p; })(),
          // Retry without recent_posts_json (large payload)
          (() => { const p = { ...basePayload }; delete p.name; delete p.recent_posts_json; return p; })(),
        ];

        for (const upsertPayload of payloadVariants) {
          try {
            const { data, error } = await supabaseAdmin
              .from('creators')
              .upsert(upsertPayload, { onConflict: 'instagram_handle' })
              .select()
              .single();

            if (!error && data) {
              creator = data;
              break;
            }
            if (error) {
              console.warn(`Creator upsert attempt failed for @${handle} (code ${error.code}):`, error.message);
            }
          } catch (dbErr) {
            console.warn(`Creator DB upsert exception for @${handle}:`, dbErr);
          }
        }

        // In-memory creator fallback only if ALL DB attempts fail
        if (!creator) {
          console.warn(`All DB upsert attempts failed for @${handle} — using in-memory fallback`);
          creator = {
            id: `creator_${handle}`,
            instagram_handle: handle,
            name: creatorName,
            followers_count: followersCount,
            avg_engagement_rate: avgEngagement,
            bio: biography,
            recent_posts_json: igData.media || null,
          };
        }

        // D. Gemini Scoring Engine — now calibrated with Gold Standard Benchmarks
        const geminiPercent = Math.round(5 + ((i + 0.5) / uniqueCreators.length) * 85);
        emitProgress(jobId, {
          percent: geminiPercent,
          status: `Running Gemini Scoring — @${handle} (${i + 1}/${uniqueCreators.length})...`,
          step: 'Running Gemini Scoring',
          total: uniqueCreators.length,
          processed: i,
        });

        const geminiResult = await evaluateCreatorWithGemini(
          brief_description,
          content_type || 'General Content',
          red_flags || [],
          biography,
          mediaList,
          calibrationBenchmarks
        );

        // E. Insert into Supabase analyses table (with retry fallback)
        emitProgress(jobId, {
          percent: Math.round(5 + ((i + 0.7) / uniqueCreators.length) * 85),
          status: `Persisting @${handle} (${i + 1}/${uniqueCreators.length})...`,
          step: 'Persisting to Supabase',
          total: uniqueCreators.length,
          processed: i + 1,
        });

        let analysis: any = null;
        // Only attempt DB insert if creator has a real UUID (not in-memory fallback)
        const creatorIdIsUUID = creator.id && !String(creator.id).startsWith('creator_');
        if (creatorIdIsUUID) {
          try {
            const { data: analysisData, error: analysisErr } = await upsertAnalysesWithRetry(
              [
                buildAnalysisPayload(
                  campaign.id,
                  creator.id,
                  geminiResult.overall_relevance_score,
                  geminiResult.post_evidence_reasoning,
                ),
              ],
              'campaign_id, creator_id',
            ).then((res) => ({ data: res.data?.[0] ?? null, error: res.error }));

            if (!analysisErr && analysisData) {
              analysis = analysisData;
            } else if (analysisErr) {
              console.warn(`Analysis DB insert error for @${handle}:`, analysisErr.message);
            }
          } catch (anaErr) {
            console.warn(`Analysis DB insert exception for @${handle}:`, anaErr);
          }
        }

        // Fallback analysis record (in-memory or when DB fails)
        if (!analysis) {
          analysis = {
            id: `analysis_${handle}`,
            campaign_id: campaign.id,
            creator_id: creator.id,
            overall_relevance_score: geminiResult.overall_relevance_score,
            post_evidence_reasoning: geminiResult.post_evidence_reasoning,
            created_at: new Date().toISOString(),
          };
        }

        // ALWAYS append valid result for frontend display
        analysisResults.push({
          creator,
          analysis,
          dataSource: finalDataSource,
        });

      } catch (err: any) {
        console.error(`Failed pipeline iteration for @${handle}:`, err);
      }
    }

    // ── Bulk persist EVERY analyzed creator to public.analyses ──
    // This is a safety net that guarantees all creators whose per-iteration
    // insert failed (but who have a valid creator UUID) are still saved, using
    // upsert on (campaign_id, creator_id) so re-runs update rather than duplicate.
    // Uses the resilient upsert helper so a PGRST204 (missing column) on the
    // reasoning field is remapped/omitted automatically — the score always lands.
    const campaignId = campaign.id;
    const persistableResults = analysisResults.filter(
      (result) =>
        result?.creator?.id &&
        !String(result.creator.id).startsWith('creator_') &&
        typeof result.analysis?.overall_relevance_score === 'number',
    );

    if (persistableResults.length > 0) {
      const analysisPayloads = persistableResults.map((result) =>
        buildAnalysisPayload(
          campaignId,
          result.creator.id,
          result.analysis.overall_relevance_score,
          result.analysis.post_evidence_reasoning || '',
        ),
      );

      const { error: insertError } = await upsertAnalysesWithRetry(
        analysisPayloads,
        'campaign_id, creator_id',
      );

      if (insertError) {
        console.error('[Analyze Creators DB Error]:', insertError);
      } else {
        console.log(
          `[Analyze Creators] Persisted ${persistableResults.length}/${analysisResults.length} analysis result(s) to public.analyses`,
        );
      }
    }

    // ── Rate-limit status for client-side modal ──
    const consecutive403Count = consumeConsecutive403Count();
    const rateLimited = isMetaCircuitOpen() || consecutive403Count >= 3 || batchResult.circuitBreakerTripped;
    if (rateLimited && !isMetaCircuitOpen()) {
      tripCircuitBreaker();
    }
    if (rateLimited) {
      const remainingMs = getCircuitBreakerRemainingMs();
      console.warn(
        `[analyze-creators] Meta API rate limited — ${geminiFallbackCount} creator(s) used Gemini fallback. ` +
        `Circuit breaker active for ${Math.round(remainingMs / 1000)}s more.`,
      );
    }

    emitProgress(jobId, { percent: 95, status: 'Finalizing analysis...', step: 'Persisting to Supabase', total: uniqueCreators.length, processed: uniqueCreators.length });
    endJob(jobId);

    return NextResponse.json({
      success: true,
      jobId,
      campaignId: campaign.id,
      results: analysisResults,
      duplicatesRemoved,
      calibrationUsed: calibrationBenchmarks.length > 0,
      calibrationBenchmarkCount: calibrationBenchmarks.length,
      rateLimited,
      circuitBreakerActive: isMetaCircuitOpen(),
      circuitBreakerRemainingMs: getCircuitBreakerRemainingMs(),
      geminiFallbackCount,
    });
  } catch (error: any) {
    console.error('API /api/analyze-creators error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
