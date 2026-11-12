/**
 * The crew's own words.
 *
 * "My guys are also largely non-English speakers." The people who use the
 * clock every day are the people least served by it being in English, and a
 * timesheet somebody cannot read is a timesheet somebody guesses at -- which
 * shows up later as hours nobody can account for.
 *
 * Scope is deliberate: the screens a crew member actually touches. The office
 * side is not here. Translating everything badly is worse than translating
 * the clock well, and a half-translated screen is the most confusing of the
 * three states.
 *
 * Spanish as it is spoken by the people who will read it -- "marcar entrada",
 * not a dictionary rendering of "clock in".
 *
 * `{name}` holes are filled by `fill` below. They are written identically in
 * both languages so a missing one is a check failure rather than a sentence
 * with a gap in it.
 */
export type Lang = "en" | "es";
export const LANGS: Lang[] = ["en", "es"];

/** What the toggle says, in its own language, always. */
export const LANG_NAME: Record<Lang, string> = { en: "English", es: "Español" };

export const SAY = {
  // --- the clock itself
  timesheet:        { en: "Timesheet",        es: "Mis horas" },
  today:            { en: "Today",            es: "Hoy" },
  thisWeek:         { en: "This Week",        es: "Esta semana" },
  lastWeek:         { en: "Last Week",        es: "Semana pasada" },
  showLastWeek:     { en: "Show Last Week",   es: "Ver semana pasada" },
  showThisWeek:     { en: "Show This Week",   es: "Ver esta semana" },
  hours:            { en: "hours",            es: "horas" },
  total:            { en: "Total",            es: "Total" },
  status:           { en: "Status",           es: "Estado" },

  onTheClock:       { en: "On the Clock",     es: "Trabajando" },
  offTheClock:      { en: "Off the Clock",    es: "Fuera de turno" },
  onBreak:          { en: "On Break",         es: "En descanso" },

  clockIn:          { en: "Clock In",         es: "Marcar entrada" },
  clockOut:         { en: "Clock Out",        es: "Marcar salida" },
  beginBreak:       { en: "Begin Break",      es: "Empezar descanso" },
  endBreak:         { en: "End Break",        es: "Terminar descanso" },

  checkingLocation: { en: "Checking your location…", es: "Buscando tu ubicación…" },
  pleaseWait:       { en: "Please wait…",     es: "Espera…" },
  loadingTimesheet: { en: "Loading your timesheet…", es: "Cargando tus horas…" },
  noHoursToday:     { en: "No hours recorded today.",
                      es: "No hay horas registradas hoy." },

  // --- which job
  whichJob:         { en: "Which job are you on?", es: "¿En qué trabajo estás?" },
  selectProperty:   { en: "Select a property", es: "Elige una propiedad" },
  noJobRecorded:    { en: "No job recorded",  es: "Sin trabajo registrado" },
  searchPlace:      { en: "Park, street, or lot number",
                      es: "Parque, calle o número de lote" },
  whichLot:         { en: "Which lot?",       es: "¿Cuál lote?" },
  wholePark:        { en: "The whole park",   es: "Todo el parque" },
  noPlaceMatch:     { en: "Nothing matches that.", es: "No encontramos nada así." },

  // --- where are you, before the clock starts
  looksLikeHere:    { en: "Looks like you're at", es: "Parece que estás en" },
  clockInAt:        { en: "Clock In at {name}", es: "Marcar entrada en {name}" },
  somewhereElse:    { en: "I'm at a different job", es: "Estoy en otro trabajo" },
  nearYou:          { en: "Jobs near you",     es: "Trabajos cerca de ti" },
  otherJob:         { en: "Another job",       es: "Otro trabajo" },
  away:             { en: "{far} away",        es: "a {far}" },
  areYouSure:       { en: "You're {far} from {name}. Clock in there anyway?",
                      es: "Estás a {far} de {name}. ¿Marcar entrada ahí de todos modos?" },
  areYouSureWhy:    { en: "Your crew lead will see that you clocked in {far} away.",
                      es: "Tu jefe de cuadrilla verá que marcaste a {far} de distancia." },
  yesClockIn:       { en: "Yes, Clock In There", es: "Sí, marcar entrada ahí" },
  pickAgain:        { en: "Pick Again",        es: "Elegir otra vez" },
  noPinOnJob:       { en: "This job has no map pin, so your location can't be checked against it.",
                      es: "Este trabajo no tiene ubicación en el mapa, así que no se puede comparar con la tuya." },
  noLocation:       { en: "We couldn't get your location.",
                      es: "No pudimos obtener tu ubicación." },
  noLocationHow:    { en: "Location has to be on for the crew clock. When your phone asks, tap Allow. If you already said no: iPhone — Settings, Privacy, Location Services, Safari Websites, While Using. Android — tap the lock beside the address, then Location, Allow.",
                      es: "La ubicación tiene que estar encendida para el reloj. Cuando tu teléfono pregunte, toca Permitir. Si ya dijiste que no: iPhone — Ajustes, Privacidad, Localización, Sitios web de Safari, Al usar. Android — toca el candado junto a la dirección, luego Ubicación, Permitir." },
  tryAgain:         { en: "Try Again",         es: "Intentar de nuevo" },
  clockInNoLocation:{ en: "Clock In Without Location", es: "Marcar entrada sin ubicación" },
  noLocationWhy:    { en: "Your crew lead will see that there was no location.",
                      es: "Tu jefe de cuadrilla verá que no hubo ubicación." },
  photosInstead:    { en: "Or clock in with two photos instead:",
                      es: "O marca entrada con dos fotos:" },
  takeSelfie:       { en: "1. Take a Selfie",  es: "1. Tómate una selfie" },
  takeSelfieHow:    { en: "Your whole face, in good light. If you can, get the house or lot number behind you.",
                      es: "Toda tu cara, con buena luz. Si puedes, que se vea detrás el número de la casa o del lote." },
  takeSitePhoto:    { en: "2. Photo of the Job", es: "2. Foto del trabajo" },
  takeSitePhotoHow: { en: "The front of the house, the mailbox, or the lot number — something that shows which job this is.",
                      es: "El frente de la casa, el buzón o el número del lote — algo que muestre qué trabajo es." },
  thenPickJob:      { en: "3. Which job?",     es: "3. ¿Qué trabajo?" },
  retake:           { en: "Retake",            es: "Tomar otra" },
  openCamera:       { en: "Open the Camera",   es: "Abrir la cámara" },
  uploading:        { en: "Uploading…",        es: "Subiendo…" },
  photoTaken:       { en: "Taken",             es: "Tomada" },

  // --- approval
  submitHours:      { en: "Submit {hours} Hours for Approval",
                      es: "Enviar {hours} horas para aprobación" },
  submitted:        { en: "Hours submitted for approval.",
                      es: "Horas enviadas para aprobación." },
  approved:         { en: "Approved",         es: "Aprobado" },
  declined:         { en: "Declined",         es: "Rechazado" },
  awaitingApproval: { en: "Awaiting approval", es: "Esperando aprobación" },
  pendingReview:    { en: "Pending Review",   es: "Pendiente de revisión" },
  inProgress:       { en: "In progress",      es: "En curso" },

  // --- corrections
  corrections:      { en: "Corrections",      es: "Correcciones" },
  actualStart:      { en: "Actual start",     es: "Hora real de entrada" },
  actualFinish:     { en: "Actual finish",    es: "Hora real de salida" },
  breakLength:      { en: "Break length, in minutes",
                      es: "Duración del descanso, en minutos" },
  somethingElse:    { en: "Something else",   es: "Otra cosa" },
  notListed:        { en: "Not listed",       es: "No aparece" },
  cancel:           { en: "Cancel",           es: "Cancelar" },
  requestSent:      { en: "Your request has been sent to the office.",
                      es: "Tu solicitud fue enviada a la oficina." },

  // --- asking the office
  needSomething:    { en: "Need Something?",  es: "¿Necesitas algo?" },
  needSomethingWhy: { en: "Goes to the office, not to tenants. Which job you are on is sent with it, so nobody has to ask where you are.",
                      es: "Va a la oficina, no a los inquilinos. Se envía con el trabajo en el que estás, para que nadie tenga que preguntar dónde andas." },
  needSomethingEg:  { en: "A part, a key, a dumpster, a question about the unit.",
                      es: "Una pieza, una llave, un contenedor, una pregunta sobre la casa." },
  sendToOffice:     { en: "Send to the Office", es: "Enviar a la oficina" },
  sending:          { en: "Sending…",         es: "Enviando…" },
  officeReplied:    { en: "The office replied", es: "La oficina respondió" },
  officeRepliedN:   { en: "The office replied — {n} new messages",
                      es: "La oficina respondió — {n} mensajes nuevos" },
  replyWillBeIn:    { en: "The reply will be in your messages.",
                      es: "La respuesta estará en tus mensajes." },
  sentToN:          { en: "Sent. {n} at the office can see it.",
                      es: "Enviado. {n} en la oficina pueden verlo." },
  sentNobody:       { en: "Kept — but nobody at the office has an account yet, so nobody has been alerted.",
                      es: "Guardado — pero nadie en la oficina tiene cuenta todavía, así que no se avisó a nadie." },

  // --- things going wrong
  didNotGoThrough:  { en: "That did not go through. Please try again.",
                      es: "No se pudo. Inténtalo de nuevo." },
  didNotSend:       { en: "That did not send. Check your signal and try again.",
                      es: "No se envió. Revisa tu señal e inténtalo de nuevo." },
  noConnection:     { en: "No connection. Check your signal and try again.",
                      es: "Sin conexión. Revisa tu señal e inténtalo de nuevo." },

  // --- choosing your own PIN
  choosePin:        { en: "Choose your PIN",  es: "Elige tu PIN" },
  choosePinWhy:     { en: "Four to eight numbers. Only you know it — the office cannot see it and cannot set it for you.",
                      es: "De cuatro a ocho números. Solo tú lo sabes — la oficina no puede verlo ni ponerlo por ti." },
  confirmPin:       { en: "Type it again",   es: "Escríbelo otra vez" },
  pinsDoNotMatch:   { en: "Those two don't match.", es: "Los dos no coinciden." },
  pinTooShort:      { en: "A PIN is 4 to 8 numbers.", es: "Un PIN es de 4 a 8 números." },
  savePin:          { en: "Save my PIN",     es: "Guardar mi PIN" },
  saving:           { en: "Saving…",         es: "Guardando…" },
  pinSaved:         { en: "Saved. Use it next time you sign in.",
                      es: "Guardado. Úsalo la próxima vez que entres." },
  changeMyPin:      { en: "Change my PIN",   es: "Cambiar mi PIN" },

  // --- signing in
  signIn:           { en: "Sign in",          es: "Iniciar sesión" },
  whoSigningIn:     { en: "Who's signing in?", es: "¿Quién eres?" },
  searchYourName:   { en: "Search your name", es: "Busca tu nombre" },
  enterYourPin:     { en: "Enter your 4-digit PIN.",
                      es: "Escribe tu PIN de 4 números." },
  noNameMatches:    { en: "No name matches that.", es: "Ningún nombre coincide." },
  pinWrong:         { en: "That didn't work. Try again.",
                      es: "No funcionó. Inténtalo de nuevo." },
  checking:         { en: "Checking…",        es: "Revisando…" },
  deleteKey:        { en: "Delete",           es: "Borrar" },
  useWorkEmail:     { en: "Use my work email instead",
                      es: "Usar mi correo del trabajo" },
} as const;

export type Key = keyof typeof SAY;

/** Say it, in the language asked for. */
export function say(key: Key, lang: Lang, holes?: Record<string, string | number>): string {
  const line = SAY[key][lang] as string;
  return holes ? fill(line, holes) : line;
}

/** Put the numbers in. `{n}` and `{hours}`, nothing cleverer. */
export function fill(line: string, holes: Record<string, string | number>): string {
  return line.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in holes ? String(holes[name]) : whole);
}

/**
 * Which language, without anybody choosing.
 *
 * "I want people to mindlessly/seamlessly clock in." A phone set to Spanish
 * is a phone belonging to somebody who reads Spanish, and asking them to pick
 * is one more screen between a man and the button he came to press. So the
 * handset decides, and the toggle exists for when it is wrong -- a shared
 * phone, a handset somebody set up in English years ago.
 *
 * A stored choice always wins, because it was made by a person.
 */
export function pickLang(stored: string | null | undefined, device: string | undefined): Lang {
  if (stored === "en" || stored === "es") return stored;
  // `es`, `es-MX`, `es-419`. Anything else is English, which is the fallback
  // rather than a claim about the reader.
  return (device ?? "").toLowerCase().startsWith("es") ? "es" : "en";
}
