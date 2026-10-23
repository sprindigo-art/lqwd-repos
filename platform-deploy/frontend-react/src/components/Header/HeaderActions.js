import { HEADER_PAGE_CHANGED } from './HeaderConstants';

export function changeHeaderPage(newpage) {
  return { type: HEADER_PAGE_CHANGED, payload: { headerpage: newpage } };
}
