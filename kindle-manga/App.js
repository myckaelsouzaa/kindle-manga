import { Model } from './Model.js';
import { View } from './View.js';
import { Controller } from './Controller.js';

// A View não conhece o Model: recebe só estas funções de consulta
View.init({ isSaved: id => Model.isSaved(id), progressOf: id => Model.progressOf(id) });
Controller.init();
