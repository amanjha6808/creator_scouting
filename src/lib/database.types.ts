export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      campaigns: {
        Row: {
          id: string
          created_at: string
          title: string
          brief_description: string
          content_type: string
          red_flags: string[] | null
        }
        Insert: {
          id?: string
          created_at?: string
          title: string
          brief_description: string
          content_type: string
          red_flags?: string[] | null
        }
        Update: {
          id?: string
          created_at?: string
          title?: string
          brief_description?: string
          content_type?: string
          red_flags?: string[] | null
        }
        Relationships: []
      }
      creators: {
        Row: {
          id: string
          updated_at: string
          instagram_handle: string
          name: string | null
          followers_count: number | null
          avg_engagement_rate: number | null
          bio: string | null
          recent_posts_json: Json | null
        }
        Insert: {
          id?: string
          updated_at?: string
          instagram_handle: string
          name?: string | null
          followers_count?: number | null
          avg_engagement_rate?: number | null
          bio?: string | null
          recent_posts_json?: Json | null
        }
        Update: {
          id?: string
          updated_at?: string
          instagram_handle?: string
          name?: string | null
          followers_count?: number | null
          avg_engagement_rate?: number | null
          bio?: string | null
          recent_posts_json?: Json | null
        }
        Relationships: []
      }
      analyses: {
        Row: {
          id: string
          created_at: string
          campaign_id: string
          creator_id: string
          overall_relevance_score: number
          post_evidence_reasoning: string
        }
        Insert: {
          id?: string
          created_at?: string
          campaign_id: string
          creator_id: string
          overall_relevance_score: number
          post_evidence_reasoning: string
        }
        Update: {
          id?: string
          created_at?: string
          campaign_id?: string
          creator_id?: string
          overall_relevance_score?: number
          post_evidence_reasoning?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyses_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyses_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          }
        ]
      }
      historical_benchmarks: {
        Row: {
          id: string
          created_at: string
          creator_handle: string
          creator_name: string | null
          content_category: string
          performance_tier: 'High Performer' | 'Average' | 'Flop'
          reel_url: string | null
          performance_notes: string | null
          views: number | null
          likes: number | null
          comments: number | null
          engagement_rate: number | null
          profile_link: string | null
          commercial_cost: number | null
          cost_per_view: number | null
          reach_efficiency_pct: number | null
          roi_rating: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          creator_handle: string
          creator_name?: string | null
          content_category: string
          performance_tier: 'High Performer' | 'Average' | 'Flop'
          reel_url?: string | null
          performance_notes?: string | null
          views?: number | null
          likes?: number | null
          comments?: number | null
          engagement_rate?: number | null
          profile_link?: string | null
          commercial_cost?: number | null
          cost_per_view?: number | null
          reach_efficiency_pct?: number | null
          roi_rating?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          creator_handle?: string
          creator_name?: string | null
          content_category?: string
          performance_tier?: 'High Performer' | 'Average' | 'Flop'
          reel_url?: string | null
          performance_notes?: string | null
          views?: number | null
          likes?: number | null
          comments?: number | null
          engagement_rate?: number | null
          profile_link?: string | null
          commercial_cost?: number | null
          cost_per_view?: number | null
          reach_efficiency_pct?: number | null
          roi_rating?: string | null
        }
        Relationships: []
      }
      instagram_reel_metrics: {
        Row: {
          reel_url: string
          media_id: string | null
          views: number | null
          likes: number | null
          comments: number | null
          shares: number | null
          fetched_at: string
          last_error: string | null
        }
        Insert: {
          reel_url: string
          media_id?: string | null
          views?: number | null
          likes?: number | null
          comments?: number | null
          shares?: number | null
          fetched_at?: string
          last_error?: string | null
        }
        Update: {
          reel_url?: string
          media_id?: string | null
          views?: number | null
          likes?: number | null
          comments?: number | null
          shares?: number | null
          fetched_at?: string
          last_error?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
