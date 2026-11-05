import { Model } from './Model.js';
import { View } from './View.js';
import { Controller } from './Controller.js';

// A View não conhece o Model: recebe só estas funções de consulta
View.init({
  isSaved: id => Model.isSaved(id),
  progressOf: id => Model.progressOf(id),
  isChapterRead: (mangaId, chapterId) => Model.isChapterRead(mangaId, chapterId),
  isChapterDownloaded: id => Model.isChapterDownloaded(id)
});
Model.recommendationOpened = Model.recommendationOpened || false;
Controller.init();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
