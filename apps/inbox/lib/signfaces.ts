/**
 * The hands a typed signature can be written in.
 *
 * Self-hosted rather than fetched from a font service, for two reasons
 * that both matter here. A signature has to come out the same on the
 * laptop at the desk and the phone in the truck, and a face that is
 * "whatever the browser calls cursive" does not. And a document being
 * signed is not the moment to depend on somebody else's server being up.
 *
 * All three are SIL Open Font License, which permits this.
 */
export type Face = {
  key: string;
  /** What the picker calls it. */
  name: string;
  /** The CSS family name, which must match the @font-face in globals.css. */
  family: string;
  /** How tall to draw it, relative to the others, so they look alike. */
  scale: number;
};

export const FACES: Face[] = [
  { key: "flowing", name: "Flowing", family: "SignFlowing", scale: 1 },
  { key: "formal", name: "Formal", family: "SignFormal", scale: 1.12 },
  { key: "penned", name: "Penned", family: "SignPenned", scale: 0.78 },
];

export const faceOf = (key: string): Face => FACES.find((f) => f.key === key) ?? FACES[0];

/**
 * A typed name, drawn as a picture.
 *
 * It becomes a PNG like any other signature, so everything downstream --
 * the documents, the Word file, the PDF -- knows nothing about fonts.
 *
 * Drawn at three times the size it prints at, because a signature that
 * is sharp on screen and soft on paper is a signature somebody will
 * complain about once and then stop using.
 */
export async function typedSignature(
  name: string, faceKey: string,
): Promise<string> {
  const text = name.trim();
  if (!text) throw new Error("Type the name to sign with.");
  const face = faceOf(faceKey);

  /* The face has to be LOADED, not merely asked for: a canvas asked to
     draw in a family the browser has not fetched yet silently falls back
     to the default, and the signature comes out in Times. */
  const size = Math.round(150 * face.scale);
  const spec = `${size}px "${face.family}"`;
  if (typeof document !== "undefined" && document.fonts) {
    await document.fonts.load(spec, text);
    if (!document.fonts.check(spec)) {
      throw new Error("That handwriting could not be loaded. Try another,"
        + " or draw your signature instead.");
    }
  }

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("This browser cannot draw a signature.");
  measure.font = spec;
  const m = measure.measureText(text);
  /* The actual ink, not the line box: a cursive face has long ascenders
     and descenders and the em box is the wrong shape for both. */
  const left = m.actualBoundingBoxLeft ?? 0;
  const right = m.actualBoundingBoxRight ?? m.width;
  const up = m.actualBoundingBoxAscent ?? size * 0.8;
  const down = m.actualBoundingBoxDescent ?? size * 0.3;
  const pad = Math.round(size * 0.08);

  const c = document.createElement("canvas");
  c.width = Math.ceil(left + right) + pad * 2;
  c.height = Math.ceil(up + down) + pad * 2;
  const g = c.getContext("2d");
  if (!g) throw new Error("This browser cannot draw a signature.");
  g.font = spec;
  g.fillStyle = "#101828";
  g.textBaseline = "alphabetic";
  g.fillText(text, pad + left, pad + up);
  return c.toDataURL("image/png");
}
