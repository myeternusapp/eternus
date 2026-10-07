// Server-side answers for every class where model text is never shown (approved decision D6),
// plus blocking and error states. Languages: en, pt, es, fr, it, de, el; English otherwise.
import { SUPPORT_EMAIL } from './config.js';

const S = SUPPORT_EMAIL;

export const TEMPLATES = {
  unknown: {
    en: `I can't answer that from Eternus's help information, and I don't want to guess. Please contact Eternus support at ${S}.`,
    pt: `Não consigo responder a isso com base nas informações de ajuda da Eternus e não quero adivinhar. Contacte o suporte da Eternus em ${S}.`,
    es: `No puedo responder a eso con la información de ayuda de Eternus y no quiero adivinar. Contacta con el soporte de Eternus en ${S}.`,
    fr: `Je ne peux pas répondre à cette question à partir de l'aide d'Eternus, et je préfère ne pas deviner. Contactez le support Eternus à ${S}.`,
    it: `Non posso rispondere a questa domanda con le informazioni di aiuto di Eternus e non voglio tirare a indovinare. Contatta il supporto Eternus all'indirizzo ${S}.`,
    de: `Das kann ich anhand der Eternus-Hilfeinformationen nicht beantworten, und ich möchte nicht raten. Bitte wende dich an den Eternus-Support unter ${S}.`,
    el: `Δεν μπορώ να απαντήσω σε αυτό με βάση τις πληροφορίες βοήθειας του Eternus και δεν θέλω να μαντέψω. Επικοινωνήστε με την υποστήριξη του Eternus στο ${S}.`,
  },
  off_topic: {
    en: `I can only help with questions about Eternus. Ask me about Moments, Private, Circle and Legacy, your profile, the Digital Tree or Eternus Web.`,
    pt: `Só posso ajudar com perguntas sobre a Eternus. Pergunte-me sobre Moments, Private, Circle e Legacy, o seu perfil, a Digital Tree ou a Eternus Web.`,
    es: `Solo puedo ayudar con preguntas sobre Eternus. Pregúntame sobre Moments, Private, Circle y Legacy, tu perfil, la Digital Tree o Eternus Web.`,
    fr: `Je ne peux répondre qu'aux questions sur Eternus. Posez-moi vos questions sur les Moments, Private, Circle et Legacy, votre profil, la Digital Tree ou Eternus Web.`,
    it: `Posso aiutarti solo con domande su Eternus. Chiedimi dei Moments, di Private, Circle e Legacy, del tuo profilo, della Digital Tree o di Eternus Web.`,
    de: `Ich kann nur Fragen zu Eternus beantworten. Frag mich zu Moments, Private, Circle und Legacy, deinem Profil, dem Digital Tree oder Eternus Web.`,
    el: `Μπορώ να βοηθήσω μόνο με ερωτήσεις για το Eternus. Ρωτήστε με για τα Moments, το Private, το Circle και το Legacy, το προφίλ σας, το Digital Tree ή το Eternus Web.`,
  },
  account_specific: {
    en: `I can't see or change any Eternus account, so I can't check or do that for you. Please never share passwords or verification codes here. For help with your account, contact Eternus support at ${S}.`,
    pt: `Não consigo ver nem alterar nenhuma conta Eternus, por isso não posso verificar nem fazer isso por si. Nunca partilhe aqui palavras-passe ou códigos de verificação. Para ajuda com a sua conta, contacte o suporte da Eternus em ${S}.`,
    es: `No puedo ver ni cambiar ninguna cuenta de Eternus, así que no puedo comprobar ni hacer eso por ti. Nunca compartas aquí contraseñas ni códigos de verificación. Para ayuda con tu cuenta, contacta con el soporte de Eternus en ${S}.`,
    fr: `Je ne peux ni voir ni modifier aucun compte Eternus, je ne peux donc pas vérifier ou faire cela pour vous. Ne partagez jamais ici de mot de passe ni de code de vérification. Pour obtenir de l'aide sur votre compte, contactez le support Eternus à ${S}.`,
    it: `Non posso vedere né modificare alcun account Eternus, quindi non posso verificarlo o farlo al posto tuo. Non condividere mai qui password o codici di verifica. Per assistenza sul tuo account, contatta il supporto Eternus all'indirizzo ${S}.`,
    de: `Ich kann kein Eternus-Konto sehen oder ändern und das deshalb nicht für dich prüfen oder erledigen. Teile hier bitte niemals Passwörter oder Bestätigungscodes. Für Hilfe zu deinem Konto wende dich an den Eternus-Support unter ${S}.`,
    el: `Δεν μπορώ να δω ή να αλλάξω κανέναν λογαριασμό Eternus, οπότε δεν μπορώ να το ελέγξω ή να το κάνω για εσάς. Μην κοινοποιείτε ποτέ εδώ κωδικούς πρόσβασης ή κωδικούς επαλήθευσης. Για βοήθεια με τον λογαριασμό σας, επικοινωνήστε με την υποστήριξη του Eternus στο ${S}.`,
  },
  injection: {
    en: `I can only answer questions about how Eternus works, using Eternus's help information. What would you like to know about Eternus?`,
    pt: `Só posso responder a perguntas sobre o funcionamento da Eternus, com base nas informações de ajuda da Eternus. O que gostaria de saber sobre a Eternus?`,
    es: `Solo puedo responder a preguntas sobre cómo funciona Eternus, con la información de ayuda de Eternus. ¿Qué te gustaría saber sobre Eternus?`,
    fr: `Je ne peux répondre qu'aux questions sur le fonctionnement d'Eternus, à partir de l'aide d'Eternus. Que souhaitez-vous savoir sur Eternus ?`,
    it: `Posso rispondere solo a domande su come funziona Eternus, usando le informazioni di aiuto di Eternus. Cosa vorresti sapere su Eternus?`,
    de: `Ich kann nur Fragen dazu beantworten, wie Eternus funktioniert, anhand der Eternus-Hilfeinformationen. Was möchtest du über Eternus wissen?`,
    el: `Μπορώ να απαντώ μόνο σε ερωτήσεις για το πώς λειτουργεί το Eternus, με βάση τις πληροφορίες βοήθειας του Eternus. Τι θα θέλατε να μάθετε για το Eternus;`,
  },
  invalid_input: {
    en: `Please type a question about Eternus of up to 500 characters.`,
    pt: `Escreva uma pergunta sobre a Eternus com até 500 caracteres.`,
    es: `Escribe una pregunta sobre Eternus de hasta 500 caracteres.`,
    fr: `Saisissez une question sur Eternus de 500 caractères maximum.`,
    it: `Scrivi una domanda su Eternus di massimo 500 caratteri.`,
    de: `Bitte gib eine Frage zu Eternus mit höchstens 500 Zeichen ein.`,
    el: `Γράψτε μια ερώτηση για το Eternus έως 500 χαρακτήρες.`,
  },
  rate_limited: {
    en: `You've asked several questions in a short time. Please wait a moment and try again.`,
    pt: `Fez várias perguntas em pouco tempo. Aguarde um momento e tente novamente.`,
    es: `Has hecho varias preguntas en poco tiempo. Espera un momento y vuelve a intentarlo.`,
    fr: `Vous avez posé plusieurs questions en peu de temps. Patientez un instant, puis réessayez.`,
    it: `Hai fatto diverse domande in poco tempo. Attendi un momento e riprova.`,
    de: `Du hast in kurzer Zeit mehrere Fragen gestellt. Bitte warte einen Moment und versuche es erneut.`,
    el: `Κάνατε αρκετές ερωτήσεις σε λίγο χρόνο. Περιμένετε λίγο και δοκιμάστε ξανά.`,
  },
  unavailable: {
    en: `Ask Eternus isn't available right now. For help, contact Eternus support at ${S}.`,
    pt: `O Ask Eternus não está disponível neste momento. Para ajuda, contacte o suporte da Eternus em ${S}.`,
    es: `Ask Eternus no está disponible en este momento. Para obtener ayuda, contacta con el soporte de Eternus en ${S}.`,
    fr: `Ask Eternus n'est pas disponible pour le moment. Pour obtenir de l'aide, contactez le support Eternus à ${S}.`,
    it: `Ask Eternus non è disponibile al momento. Per assistenza, contatta il supporto Eternus all'indirizzo ${S}.`,
    de: `Ask Eternus ist gerade nicht verfügbar. Für Hilfe wende dich an den Eternus-Support unter ${S}.`,
    el: `Το Ask Eternus δεν είναι διαθέσιμο αυτή τη στιγμή. Για βοήθεια, επικοινωνήστε με την υποστήριξη του Eternus στο ${S}.`,
  },
  error: {
    en: `Something went wrong and I couldn't answer. Please try again later, or contact Eternus support at ${S}.`,
    pt: `Ocorreu um problema e não consegui responder. Tente novamente mais tarde ou contacte o suporte da Eternus em ${S}.`,
    es: `Algo ha fallado y no he podido responder. Vuelve a intentarlo más tarde o contacta con el soporte de Eternus en ${S}.`,
    fr: `Un problème est survenu et je n'ai pas pu répondre. Réessayez plus tard ou contactez le support Eternus à ${S}.`,
    it: `Qualcosa è andato storto e non sono riuscito a rispondere. Riprova più tardi o contatta il supporto Eternus all'indirizzo ${S}.`,
    de: `Etwas ist schiefgelaufen, und ich konnte nicht antworten. Bitte versuche es später erneut oder wende dich an den Eternus-Support unter ${S}.`,
    el: `Κάτι πήγε στραβά και δεν μπόρεσα να απαντήσω. Δοκιμάστε ξανά αργότερα ή επικοινωνήστε με την υποστήριξη του Eternus στο ${S}.`,
  },
};

export const TEMPLATE_LANGUAGES = ['en', 'pt', 'es', 'fr', 'it', 'de', 'el'];

/** Primary language subtag if we have templates for it, else English. */
export function templateLanguage(tag) {
  const primary = typeof tag === 'string' ? tag.toLowerCase().split('-')[0] : '';
  return TEMPLATE_LANGUAGES.includes(primary) ? primary : 'en';
}

export function template(kind, tag) {
  const lang = templateLanguage(tag);
  return { text: TEMPLATES[kind][lang], language: lang };
}
