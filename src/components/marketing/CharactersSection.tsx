import { characters } from '../../data/marketing'
import { CharacterAsset } from './Assets'
export function CharactersSection() {
  return <section className="section cast-section" aria-labelledby="cast-heading"><span className="section-label">03 / A little company. A little trouble.</span><h2 id="cast-heading">Meet the ruins.</h2><div className="cast-grid">{characters.map(character => <article key={character.id} className={`cast-member cast-${character.id}`}><CharacterAsset character={character.id} /><span className="section-label">{character.role}</span><h3>{character.name}</h3><p>{character.text}</p></article>)}</div></section>
}
