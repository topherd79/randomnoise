// Listening links shown after a player answers. Exact links come from the
// details lookup; without one we link to a search, which always works.

type LinkSource = { title: string; artist: string; appleMusicUrl: string | null; spotifyUrl: string | null };

export function appleMusicLink(song: LinkSource): string {
  return (
    song.appleMusicUrl ??
    `https://music.apple.com/us/search?term=${encodeURIComponent(`${song.title} ${song.artist}`)}`
  );
}

export function spotifyLink(song: LinkSource): string {
  return song.spotifyUrl ?? `https://open.spotify.com/search/${encodeURIComponent(`${song.title} ${song.artist}`)}`;
}
