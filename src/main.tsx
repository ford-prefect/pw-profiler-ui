import '@fontsource-variable/inter';
import { render } from 'preact';
import { App } from './view/App';

/* Charts draw text on canvas, so wait for the font to avoid a fallback. */
document.fonts
  .load("14px 'Inter Variable'")
  .catch(() => undefined)
  .then(() => render(<App />, document.getElementById('app')!));
