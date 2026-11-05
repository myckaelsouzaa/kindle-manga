import { Model } from './Model.js';
import { View } from './View.js';
import { Controller } from './Controller.js';

// A View não conhece o Model: recebe só estas funções de consulta
View.init({
  isSaved: id => Model.isSaved(id),
  progressOf: id => Model.progressOf(id),
  isChapterDownloaded: id => Model.isChapterDownloaded(id)
});
Controller.init();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
