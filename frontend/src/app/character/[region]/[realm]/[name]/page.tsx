import CharacterClient from './CharacterClient';

export function generateStaticParams() {
  return [{ region: 'us', realm: 'realm', name: 'name' }];
}

export default function CharacterPage() {
  return <CharacterClient />;
}
