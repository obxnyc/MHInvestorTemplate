"use client";

/**
 * Save the page as a PDF.
 *
 * The browser's own print dialog, because that is the only thing on this
 * deployment that can turn a frozen pack into a PDF -- rendering one
 * server-side needs a headless browser, and a function here is killed at
 * sixty seconds on the Hobby plan.
 *
 * It sets `document.title` first for the reason already written down
 * about the generator: Chrome and Safari print the page's title and its
 * address into the margin unless the tick box is cleared, and a contract
 * headed with a session URL is the sort of thing that loses a deal. The
 * title is put back afterwards so the tab does not keep it.
 */
export default function PrintThis({ name }: { name: string }) {
  return (
    <button type="button" className="btn pri" onClick={() => {
      const was = document.title;
      document.title = name;
      /* Restored after the dialog closes rather than straight away: the
         print dialog reads the title when it opens, and on Safari that
         is one tick later than this handler. */
      const back = () => {
        document.title = was;
        window.removeEventListener("afterprint", back);
      };
      window.addEventListener("afterprint", back);
      window.print();
      /* A belt for the browsers that never fire afterprint. */
      setTimeout(() => { if (document.title === name) back(); }, 60000);
    }}>
      Save as PDF
    </button>
  );
}
