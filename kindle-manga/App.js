import { Model } from './Model.js';
import { View } from './View.js';
import { Controller } from './Controller.js';
import { premiumModel } from './premiumModel.js';
import { premiumView } from './premiumView.js';

// A View não conhece o Model: recebe apenas estas funções de consulta.
View.init({
  isSaved: id => Model.isSaved(id),
  progressOf: id => Model.progressOf(id),
  isChapterRead: (mangaId, chapterId) => Model.isChapterRead(mangaId, chapterId),
  isChapterDownloaded: id => Model.isChapterDownloaded(id),
  can: feature => PremiumModel.can(feature),
  planCard: () => PremiumView.profilePlan()
});

Controller.init().catch(error => {
  console.error('[MangaKindle] falha ao iniciar:', error);
  View.toast('Não foi possível iniciar o aplicativo. Recarregue a página.');
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
