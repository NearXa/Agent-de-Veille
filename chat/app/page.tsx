import { Chat } from '@/components/chat';

const SUGGESTIONS = [
  'Quelles exigences arrivent à échéance avant mars 2027 ?',
  'Quels risques ont un niveau résiduel critique, et quels lots les traitent ?',
  "Résume l'exigence EX-0004 avec son article et son URL officielle.",
  'Où en est la validation humaine et la couverture par les contrôles ?',
];

export default function Page() {
  return <Chat suggestions={SUGGESTIONS} />;
}
