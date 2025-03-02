export const languagesList: { [char: string]: string } = {
  english: 'en',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  dutch: 'nl',
  portuguese: 'pt',
  russian: 'ru',
  chinese: 'zh',
  japanese: 'ja',
  korean: 'ko',
  arabic: 'ar',
  turkish: 'tr',
  vietnamese: 'vi',
  thai: 'th',
};

export function getAllLanguagesInString(): string {
  return Object.keys(languagesList)
    .map(lang => lang.charAt(0).toUpperCase() + lang.slice(1))
    .join(', ');
}
