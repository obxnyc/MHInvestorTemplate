/** Tell the open thread to reload. The inbox does not navigate any more, so a
 *  reply or a hand-off has to say it changed something rather than relying on
 *  the page being rebuilt. */
export function threadChanged() {
  window.dispatchEvent(new Event("thread:refresh"));
}
