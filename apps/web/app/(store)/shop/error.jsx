"use client";

export default function ErrorState({ reset }) {
  return <section className="section empty"><h1>Collection unavailable</h1><p>We could not load the collection right now.</p><button className="button" onClick={() => reset()}>Try again</button></section>;
}
