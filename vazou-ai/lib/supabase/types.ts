// Tipos escritos à mão a partir de supabase/migrations/000*.sql.
// Em produção, trocar por `supabase gen types typescript` contra o projeto real.

export type Segment =
  | "clinica"
  | "odontologia"
  | "estetica"
  | "imobiliaria"
  | "academia"
  | "escola"
  | "servicos_profissionais"
  | "outro";

export type OpportunityStatus =
  | "recuperavel"
  | "quente"
  | "morno"
  | "frio"
  | "perdido"
  | "convertido";

export type Priority = "alta" | "media" | "baixa";

export type SignalType =
  | "sem_followup"
  | "demora_resposta"
  | "orcamento_sem_retorno"
  | "objecao_preco"
  | "pedido_parcelamento"
  | "vai_pensar"
  | "pergunta_disponibilidade"
  | "atendimento_abandonado"
  | "intencao_explicita_compra"
  | "oportunidade_esquecida";

export type ProbableReason = SignalType;

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string;
          name: string;
          legal_name: string | null;
          segment: Segment;
          timezone: string;
          currency: string;
          plan_id: string;
          status: "trial" | "active" | "suspended" | "canceled";
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          legal_name?: string | null;
          segment?: Segment;
          timezone?: string;
          currency?: string;
          plan_id?: string;
          status?: "trial" | "active" | "suspended" | "canceled";
        };
        Update: Partial<Database["public"]["Tables"]["companies"]["Insert"]>;
        Relationships: [];
      };
      user_profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          locale: string;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          locale?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_profiles"]["Insert"]>;
        Relationships: [];
      };
      memberships: {
        Row: {
          id: string;
          company_id: string;
          user_id: string;
          role: "owner" | "admin" | "member";
          status: "invited" | "active" | "revoked";
          invited_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          user_id: string;
          role?: "owner" | "admin" | "member";
          status?: "invited" | "active" | "revoked";
          invited_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["memberships"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "memberships_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      business_rules: {
        Row: {
          id: string;
          company_id: string;
          rule_type:
            | "max_discount_pct"
            | "payment_terms"
            | "business_hours"
            | "brand_voice"
            | "no_promise_policy"
            | "custom";
          value_json: Record<string, unknown>;
          description: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          rule_type:
            | "max_discount_pct"
            | "payment_terms"
            | "business_hours"
            | "brand_voice"
            | "no_promise_policy"
            | "custom";
          value_json?: Record<string, unknown>;
          description?: string | null;
          active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["business_rules"]["Insert"]>;
        Relationships: [];
      };
      import_batches: {
        Row: {
          id: string;
          company_id: string;
          source: "csv_upload" | "manual_paste";
          filename: string | null;
          status: "pending" | "processing" | "completed" | "failed";
          row_count: number;
          error_log: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          source: "csv_upload" | "manual_paste";
          filename?: string | null;
          status?: "pending" | "processing" | "completed" | "failed";
          row_count?: number;
          error_log?: string | null;
          created_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["import_batches"]["Insert"]>;
        Relationships: [];
      };
      contacts: {
        Row: {
          id: string;
          company_id: string;
          full_name: string;
          phone: string | null;
          email: string | null;
          external_ref: string | null;
          source: string | null;
          first_contact_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          full_name: string;
          phone?: string | null;
          email?: string | null;
          external_ref?: string | null;
          source?: string | null;
          first_contact_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["contacts"]["Insert"]>;
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          company_id: string;
          contact_id: string;
          import_batch_id: string | null;
          channel: "whatsapp" | "manual" | "email" | "instagram";
          started_at: string | null;
          last_message_at: string | null;
          status: "active" | "archived";
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          contact_id: string;
          import_batch_id?: string | null;
          channel?: "whatsapp" | "manual" | "email" | "instagram";
          started_at?: string | null;
          last_message_at?: string | null;
          status?: "active" | "archived";
        };
        Update: Partial<Database["public"]["Tables"]["conversations"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "conversations_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          company_id: string;
          sender: "contact" | "agent";
          content_text: string;
          sent_at: string;
          sequence_index: number;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          company_id: string;
          sender: "contact" | "agent";
          content_text: string;
          sent_at?: string;
          sequence_index?: number;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
        Relationships: [];
      };
      ai_processing_jobs: {
        Row: {
          id: string;
          company_id: string;
          conversation_id: string | null;
          job_type: "classify" | "generate_message";
          status: "queued" | "running" | "done" | "failed" | "needs_review";
          model: string | null;
          prompt_version: string | null;
          input_tokens: number | null;
          output_tokens: number | null;
          cost_usd_estimate: number | null;
          error: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          company_id: string;
          conversation_id?: string | null;
          job_type: "classify" | "generate_message";
          status?: "queued" | "running" | "done" | "failed" | "needs_review";
          model?: string | null;
          prompt_version?: string | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          cost_usd_estimate?: number | null;
          error?: string | null;
          completed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["ai_processing_jobs"]["Insert"]>;
        Relationships: [];
      };
      ai_call_logs: {
        Row: {
          id: string;
          job_id: string;
          company_id: string;
          request_summary_json: Record<string, unknown> | null;
          response_json: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          job_id: string;
          company_id: string;
          request_summary_json?: Record<string, unknown> | null;
          response_json?: Record<string, unknown> | null;
        };
        Update: Partial<Database["public"]["Tables"]["ai_call_logs"]["Insert"]>;
        Relationships: [];
      };
      opportunities: {
        Row: {
          id: string;
          company_id: string;
          contact_id: string;
          conversation_id: string | null;
          title: string | null;
          potential_value_cents: number | null;
          currency: string;
          status: OpportunityStatus;
          recovery_score: number | null;
          priority: Priority | null;
          probable_reason: ProbableReason | null;
          next_action_text: string | null;
          score_breakdown_json: Record<string, unknown> | null;
          last_interaction_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          contact_id: string;
          conversation_id?: string | null;
          title?: string | null;
          potential_value_cents?: number | null;
          currency?: string;
          status?: OpportunityStatus;
          recovery_score?: number | null;
          priority?: Priority | null;
          probable_reason?: ProbableReason | null;
          next_action_text?: string | null;
          score_breakdown_json?: Record<string, unknown> | null;
          last_interaction_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["opportunities"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "opportunities_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      opportunity_signals: {
        Row: {
          id: string;
          opportunity_id: string;
          signal_type: SignalType;
          detected_at: string;
          source_message_id: string | null;
          confidence: "baixa" | "media" | "alta";
        };
        Insert: {
          id?: string;
          opportunity_id: string;
          signal_type: SignalType;
          detected_at?: string;
          source_message_id?: string | null;
          confidence?: "baixa" | "media" | "alta";
        };
        Update: Partial<Database["public"]["Tables"]["opportunity_signals"]["Insert"]>;
        Relationships: [];
      };
      opportunity_status_history: {
        Row: {
          id: string;
          opportunity_id: string;
          from_status: string | null;
          to_status: string;
          changed_by: string;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          opportunity_id: string;
          from_status?: string | null;
          to_status: string;
          changed_by?: string;
          reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["opportunity_status_history"]["Insert"]>;
        Relationships: [];
      };
      recovery_messages: {
        Row: {
          id: string;
          opportunity_id: string;
          generated_text: string;
          tone: string | null;
          generated_by_model: string | null;
          prompt_version: string | null;
          approved_by_user: boolean;
          sent_manually_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          opportunity_id: string;
          generated_text: string;
          tone?: string | null;
          generated_by_model?: string | null;
          prompt_version?: string | null;
          approved_by_user?: boolean;
          sent_manually_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["recovery_messages"]["Insert"]>;
        Relationships: [];
      };
      recovered_revenue: {
        Row: {
          id: string;
          opportunity_id: string;
          company_id: string;
          amount_cents: number;
          currency: string;
          recovered_at: string;
          registered_by_user_id: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          opportunity_id: string;
          company_id: string;
          amount_cents: number;
          currency?: string;
          recovered_at?: string;
          registered_by_user_id?: string | null;
          notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["recovered_revenue"]["Insert"]>;
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string;
          company_id: string;
          actor_user_id: string | null;
          actor_type: "user" | "system" | "ai";
          action: string;
          entity_type: string;
          entity_id: string | null;
          before_json: Record<string, unknown> | null;
          after_json: Record<string, unknown> | null;
          ip: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          actor_user_id?: string | null;
          actor_type?: "user" | "system" | "ai";
          action: string;
          entity_type: string;
          entity_id?: string | null;
          before_json?: Record<string, unknown> | null;
          after_json?: Record<string, unknown> | null;
          ip?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["audit_log"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      company_metrics_summary: {
        Row: {
          company_id: string;
          potential_revenue_identified_cents: number;
          open_opportunities_count: number;
          high_priority_count: number;
          without_followup_count: number;
          ticket_medio_potential_cents: number;
          recovered_revenue_cents: number;
          new_opportunities_7d: number;
          revenue_leak_score: number | null;
        };
        Relationships: [];
      };
      company_leak_breakdown: {
        Row: {
          company_id: string;
          probable_reason: ProbableReason;
          opportunities_count: number;
          potential_value_cents: number;
        };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
  };
}
