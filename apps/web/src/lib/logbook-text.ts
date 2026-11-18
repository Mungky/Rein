export function logbookText(text: string) {
  return text.split(/(https?:\/\/[^\s<>"']+)/giu).flatMap((part, index) => {
    if (index % 2 === 0) return [{ text: part, href: null }];
    const href = part.replace(/[.,!?;:)\]}]+$/u, '');
    if (!URL.canParse(href)) return [{ text: part, href: null }];
    return [
      { text: href, href },
      { text: part.slice(href.length), href: null },
    ];
  });
}
