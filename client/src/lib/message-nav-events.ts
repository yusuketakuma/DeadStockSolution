export const MESSAGE_NAV_UPDATED_EVENT = 'dss:messages-updated';

export function notifyMessageNavUpdated() {
  window.dispatchEvent(new Event(MESSAGE_NAV_UPDATED_EVENT));
}
