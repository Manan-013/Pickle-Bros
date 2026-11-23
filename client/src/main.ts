import './style.css';
import { Game } from './game';

const game = new Game(document.getElementById('app')!);
game.start();

// Handy for debugging from the browser console during development.
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
