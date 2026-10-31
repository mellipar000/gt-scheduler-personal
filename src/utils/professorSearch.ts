export default function professorSearchUrl(name: string): string | null {
  const query = name.trim().replace(/\s+/g, ' ');
  if (!query || /^(tba|not assigned|staff)$/i.test(query)) return null;
  return `https://www.ratemyprofessors.com/search/professors/361?q=${encodeURIComponent(
    query
  )}`;
}
