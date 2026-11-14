import * as engine from '../../packages/media-engine/src';
import * as model from '../../packages/movie-maker/src/model';
import * as persistence from '../../packages/movie-maker/src/persistence';
import * as sample from '../../apps/web/src/apps/movie-maker/sample';
Object.assign(window, { movieEngine: engine, movieModel: model, moviePersistence: persistence, movieSample: sample, engineReady: true });
