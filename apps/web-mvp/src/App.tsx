import { useAppStore } from './store';
import { Home } from './screens/Home';
import { Settings } from './screens/Settings';
import { Record } from './screens/Record';
import { Review } from './screens/Review';

export function App() {
  const view = useAppStore((s) => s.view);
  switch (view) {
    case 'home':
      return <Home />;
    case 'settings':
      return <Settings />;
    case 'record':
      return <Record />;
    case 'review':
      return <Review />;
    default:
      return <Home />;
  }
}
