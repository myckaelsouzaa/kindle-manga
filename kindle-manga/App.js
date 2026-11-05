import { Model } from './Model.js';
import { View } from './View.js';
import { Controller } from './Controller.js';

// A View não conhece o Model: recebe só estas funções de consulta
View.init({
  isSaved: id => Model.isSaved(id),
  progressOf: id => Model.progressOf(id),
  isChapterDownloaded: id => Model.isChapterDownloaded(id)
});
Model.recommendationOpened = localStorage.getItem('reco-opened') === '1';
Controller.init();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
