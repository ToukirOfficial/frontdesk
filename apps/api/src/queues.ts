export const EMAIL_QUEUE = 'email';
export const KNOWLEDGE_QUEUE = 'knowledge';

export interface KnowledgeJob {
  workspaceId: string;
  sourceId: string;
}
