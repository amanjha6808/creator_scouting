export interface CreatorData {
  id?: string;
  instagram_handle: string;
  name?: string | null;
  followers_count?: number | null;
  avg_engagement_rate?: number | null;
  bio?: string | null;
}

export interface AnalysisData {
  id?: string;
  overall_relevance_score: number;
  post_evidence_reasoning: string;
}

export interface EvaluationResult {
  creator: CreatorData;
  analysis: AnalysisData;
}

/**
 * Escapes cell strings for CSV compatibility according to RFC 4180.
 * Wraps values with double quotes and escapes existing double quotes by doubling them.
 */
function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '""';
  }
  const str = String(value);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Utility to generate and trigger download of CSV export
 * Output filename: {campaign_title}_creator_scores.csv
 */
export function exportToCSV(analyses: EvaluationResult[], campaignTitle: string) {
  if (!analyses || analyses.length === 0) return;

  const headers = [
    'Name',
    'Username',
    'Profile Link',
    'Match Score',
    'Score Justification'
  ];

  const rows = analyses.map(item => {
    const handle = item.creator.instagram_handle || '';
    const name = item.creator.name || handle || 'Creator';
    const profileLink = `https://instagram.com/${handle}`;
    const matchScore = `${item.analysis.overall_relevance_score}%`;
    const scoreJustification = item.analysis.post_evidence_reasoning || '';

    return [
      escapeCsvCell(name),
      escapeCsvCell(handle),
      escapeCsvCell(profileLink),
      escapeCsvCell(matchScore),
      escapeCsvCell(scoreJustification)
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const safeTitle = (campaignTitle || 'campaign')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
  const fileName = `${safeTitle}_creator_scores.csv`;

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
