import { logger } from '../services/logger';
import { TIMELINE_EVENT_TYPES, type TimelineEventType } from '../types/timeline';

export function toTimelineEventType(s: string): TimelineEventType {
  if (TIMELINE_EVENT_TYPES.has(s as TimelineEventType)) {
    return s as TimelineEventType;
  }
  logger.warn(`Unknown timeline event type, falling back to request_update`, { unknownType: s });
  return 'request_update';
}
