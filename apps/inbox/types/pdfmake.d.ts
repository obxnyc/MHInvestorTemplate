/* pdfmake ships no types for its browser build, and only three of its
   members are touched here: the font map, the virtual file system it
   insists exists, and createPdf. Typing those three rather than pulling
   in a whole @types package keeps the surface the size of the use. */
declare module "pdfmake/build/pdfmake" {
  const pdfMake: {
    fonts: unknown;
    vfs: unknown;
    createPdf: (def: unknown) => {
      download: (name: string, cb?: () => void) => void;
      getBlob: (cb: (blob: Blob) => void) => void;
    };
  };
  export default pdfMake;
}
