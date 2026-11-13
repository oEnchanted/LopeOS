#!/usr/bin/env python3
"""Export the official MIT FFDNet clipped-color checkpoint without PyTorch.

Build-only requirements: numpy>=1.20, onnx==1.17.0. This script never imports or
executes downloaded Python. The pinned legacy PyTorch state dictionary is read
through a restricted global/persistent-storage allowlist and verified by SHA-256.

  python scripts/export-denoise-model.py --checkpoint /path/ffdnet_color_clip.pth

The end-user application requires neither Python nor this export toolchain.
"""
import argparse
import hashlib
import io
import json
import pickle
import re
import struct
from collections import OrderedDict
from pathlib import Path
from typing import NamedTuple

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

CHECKPOINT_SHA256 = '99a5081e32afdaa25df3ded11aa16447556692e550906caed320db31324af5ce'
CHECKPOINT_BYTES = 3411551
SOURCE_COMMIT = 'fc1732f4a4514e42ce15e5b3a1e18c828af47a1e'
SOURCE_URL = 'https://github.com/cszn/KAIR/releases/download/v1.0/ffdnet_color_clip.pth'
MODEL_ID = 'ffdnet-color-clip-v1'
FLOAT_STORAGE = object()


class StorageRef(NamedTuple):
    key: str
    elements: int


class TensorSpec(NamedTuple):
    storage: StorageRef
    offset: int
    shape: tuple
    stride: tuple


def rebuild_tensor(storage, offset, size, stride, requires_grad, backward_hooks):
    if not isinstance(storage, StorageRef) or offset != 0 or requires_grad is not False:
        raise ValueError('Unsupported checkpoint tensor metadata')
    if not isinstance(size, tuple) or not 1 <= len(size) <= 4:
        raise ValueError('Invalid tensor shape')
    if any(not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= 1024 for n in size):
        raise ValueError('Invalid tensor dimension')
    expected = []
    count = 1
    for dimension in reversed(size):
        expected.append(count)
        count *= dimension
    if stride != tuple(reversed(expected)) or count != storage.elements:
        raise ValueError('Only exact contiguous Float32 checkpoint tensors are accepted')
    if not isinstance(backward_hooks, OrderedDict) or backward_hooks:
        raise ValueError('Checkpoint hooks are not accepted')
    return TensorSpec(storage, offset, size, stride)


class CheckpointReader(pickle.Unpickler):
    """Resolve only three known symbols to inert/safe local implementations."""
    def __init__(self, stream, storages):
        super().__init__(stream)
        self.storages = storages

    def find_class(self, module, name):
        allowed = {
            ('collections', 'OrderedDict'): OrderedDict,
            ('torch._utils', '_rebuild_tensor_v2'): rebuild_tensor,
            ('torch', 'FloatStorage'): FLOAT_STORAGE,
        }
        try:
            return allowed[module, name]
        except KeyError:
            raise pickle.UnpicklingError('Unapproved checkpoint global: %s.%s' % (module, name))

    def persistent_load(self, value):
        if not isinstance(value, tuple) or len(value) != 6:
            raise ValueError('Invalid persistent storage reference')
        kind, dtype, key, device, elements, view = value
        if kind != 'storage' or dtype is not FLOAT_STORAGE or device != 'cpu' or view is not None:
            raise ValueError('Only plain CPU FloatStorage is accepted')
        if not isinstance(key, str) or not re.fullmatch(r'\d{1,40}', key):
            raise ValueError('Invalid storage key')
        if not isinstance(elements, int) or not 1 <= elements <= 2_000_000:
            raise ValueError('Invalid storage length')
        result = StorageRef(key, elements)
        if key in self.storages and self.storages[key] != result:
            raise ValueError('Conflicting storage references')
        self.storages[key] = result
        return result


def read_checkpoint(path):
    payload = path.read_bytes()
    if len(payload) != CHECKPOINT_BYTES or hashlib.sha256(payload).hexdigest() != CHECKPOINT_SHA256:
        raise ValueError('Only the pinned official ffdnet_color_clip.pth checkpoint is accepted')
    stream = io.BytesIO(payload)
    storages = {}
    load = lambda: CheckpointReader(stream, storages).load()
    if load() != 119547037146038801333356 or load() != 1001:
        raise ValueError('Unexpected legacy checkpoint serialization format')
    system = load()
    if not isinstance(system, dict) or system.get('little_endian') is not True:
        raise ValueError('Only the pinned little-endian checkpoint is accepted')
    state = load()
    storage_keys = load()
    if not isinstance(state, OrderedDict) or len(state) != 24:
        raise ValueError('Expected twelve convolution weights/biases')
    if not isinstance(storage_keys, list) or len(storage_keys) != len(storages) or set(storage_keys) != set(storages):
        raise ValueError('Invalid checkpoint storage index')
    arrays = {}
    for key in storage_keys:
        size_header = stream.read(8)
        if len(size_header) != 8 or struct.unpack('<q', size_header)[0] != storages[key].elements:
            raise ValueError('Invalid checkpoint Float32 storage header')
        count = storages[key].elements
        raw = stream.read(count * 4)
        if len(raw) != count * 4:
            raise ValueError('Truncated checkpoint storage')
        arrays[key] = np.frombuffer(raw, dtype='<f4').copy()
    if stream.read(1):
        raise ValueError('Unexpected trailing checkpoint data')
    weights = {}
    for index in range(12):
        channels_in = 13 if index == 0 else 96
        channels_out = 12 if index == 11 else 96
        for suffix, shape in [('weight', (channels_out, channels_in, 3, 3)), ('bias', (channels_out,))]:
            key = 'model.%d.%s' % (index * 2, suffix)
            spec = state.get(key)
            if not isinstance(spec, TensorSpec) or spec.shape != shape:
                raise ValueError('Unexpected checkpoint parameter: ' + key)
            array = arrays[spec.storage.key].reshape(shape)
            if not np.isfinite(array).all():
                raise ValueError('Nonfinite checkpoint parameter')
            weights[key] = array
    return weights


def build_model(weights, tile_size=160):
    if tile_size < 2 or tile_size % 2:
        raise ValueError('Tile size must be even')
    low = tile_size // 2
    constants = [
        numpy_helper.from_array(np.array([1, 3, low, 2, low, 2], dtype=np.int64), 'unshuffle_shape'),
        numpy_helper.from_array(np.array([1, 12, low, low], dtype=np.int64), 'unshuffle_out_shape'),
        numpy_helper.from_array(np.array([1, 1, low, low], dtype=np.int64), 'sigma_shape'),
    ]
    nodes = [
        helper.make_node('Reshape', ['image', 'unshuffle_shape'], ['unshuffle_6d']),
        helper.make_node('Transpose', ['unshuffle_6d'], ['unshuffle_ordered'], perm=[0, 1, 3, 5, 2, 4]),
        helper.make_node('Reshape', ['unshuffle_ordered', 'unshuffle_out_shape'], ['subimages']),
        helper.make_node('Expand', ['sigma', 'sigma_shape'], ['noise_map']),
        helper.make_node('Concat', ['subimages', 'noise_map'], ['network_input'], axis=1),
    ]
    previous = 'network_input'
    for index in range(12):
        weight = 'model.%d.weight' % (index * 2)
        bias = 'model.%d.bias' % (index * 2)
        constants.extend([numpy_helper.from_array(weights[weight], weight), numpy_helper.from_array(weights[bias], bias)])
        output = 'conv_%d' % index
        nodes.append(helper.make_node('Conv', [previous, weight, bias], [output], kernel_shape=[3, 3], pads=[1, 1, 1, 1], strides=[1, 1]))
        if index < 11:
            previous = 'relu_%d' % index
            nodes.append(helper.make_node('Relu', [output], [previous]))
        else:
            previous = output
    nodes.append(helper.make_node('DepthToSpace', [previous], ['denoised'], blocksize=2, mode='CRD'))
    graph = helper.make_graph(nodes, MODEL_ID, [
        helper.make_tensor_value_info('image', TensorProto.FLOAT, [1, 3, tile_size, tile_size]),
        helper.make_tensor_value_info('sigma', TensorProto.FLOAT, [1, 1, 1, 1]),
    ], [helper.make_tensor_value_info('denoised', TensorProto.FLOAT, [1, 3, tile_size, tile_size])], initializer=constants)
    model = helper.make_model(graph, producer_name='LopeOS', producer_version='1.0.0', opset_imports=[helper.make_operatorsetid('', 17)])
    model.ir_version = 9
    model.model_version = 1
    model.doc_string = 'FFDNet clipped-color, official unchanged learned weights; independent ONNX graph conversion. MIT copyright (c) 2019 Kai Zhang.'
    helper.set_model_props(model, {'model_id': MODEL_ID, 'checkpoint_sha256': CHECKPOINT_SHA256, 'source_commit': SOURCE_COMMIT, 'source_url': SOURCE_URL, 'domain': 'sRGB RGB float32 [0,1]', 'sigma': 'standard deviation in 8-bit code values divided by 255', 'output': 'direct clean RGB, not noise residual'})
    onnx.checker.check_model(model, full_check=True)
    return model


def numpy_forward(weights, image, sigma):
    """Independent small-input forward oracle for channel ordering and Conv/ReLU."""
    n, c, h, w = image.shape
    x = image.reshape(n, c, h // 2, 2, w // 2, 2).transpose(0, 1, 3, 5, 2, 4).reshape(n, c * 4, h // 2, w // 2)
    x = np.concatenate([x, np.full((n, 1, h // 2, w // 2), sigma.item(), dtype=np.float32)], axis=1)
    for index in range(12):
        padded = np.pad(x, ((0, 0), (0, 0), (1, 1), (1, 1)))
        patches = np.lib.stride_tricks.sliding_window_view(padded, (3, 3), axis=(2, 3))
        weight, bias = weights['model.%d.weight' % (index * 2)], weights['model.%d.bias' % (index * 2)]
        x = np.einsum('nchwij,ocij->nohw', patches, weight, optimize=True) + bias.reshape(1, -1, 1, 1)
        if index < 11:
            x = np.maximum(x, 0)
    return x.reshape(n, 3, 2, 2, h // 2, w // 2).transpose(0, 1, 4, 2, 5, 3).reshape(n, 3, h, w)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=Path('public/models/denoise/ffdnet-color-v1.onnx'))
    parser.add_argument('--manifest', type=Path, default=Path('docs/lightroom/denoise-model-manifest.json'))
    parser.add_argument('--skip-reference-check', action='store_true')
    args = parser.parse_args()
    weights = read_checkpoint(args.checkpoint)
    model = build_model(weights)
    reference = {'status': 'not run'}
    if not args.skip_reference_check:
        from onnx.reference import ReferenceEvaluator
        small = build_model(weights, 16)
        rng = np.random.default_rng(461)
        image = rng.uniform(0, 1, (1, 3, 16, 16)).astype(np.float32)
        sigma = np.array([[[[25 / 255]]]], dtype=np.float32)
        expected = numpy_forward(weights, image, sigma)
        actual = ReferenceEvaluator(small).run(None, {'image': image, 'sigma': sigma})[0]
        error = float(np.max(np.abs(expected - actual)))
        if not np.allclose(expected, actual, rtol=0.0002, atol=0.0002):
            raise ValueError('Independent NumPy/ONNX forward verification failed: ' + str(error))
        reference = {'status': 'passed', 'input': [1, 3, 16, 16], 'maxAbsoluteError': error, 'oracle': 'Independent NumPy convolution/unshuffle/shuffle vs ONNX ReferenceEvaluator; identical unchanged official learned weights'}
    data = model.SerializeToString(deterministic=True)
    if data != build_model(weights).SerializeToString(deterministic=True):
        raise ValueError('Repeated graph build is not deterministic')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(data)
    manifest = {
        'schemaVersion': 1, 'date': '2026-11-13', 'id': MODEL_ID, 'name': 'FFDNet Color (clipped)',
        'license': 'MIT', 'copyright': 'Copyright (c) 2019 Kai Zhang',
        'licenseFile': 'public/models/denoise/LICENSE-FFDNet.txt',
        'sourceCommit': SOURCE_COMMIT, 'architectureSource': 'https://github.com/cszn/KAIR/blob/' + SOURCE_COMMIT + '/models/network_ffdnet.py',
        'officialTestSource': 'https://github.com/cszn/KAIR/blob/' + SOURCE_COMMIT + '/main_test_ffdnet.py',
        'checkpoint': {'url': SOURCE_URL, 'bytes': CHECKPOINT_BYTES, 'sha256': CHECKPOINT_SHA256},
        'onnx': {'path': str(args.output), 'downloadPath': '/models/denoise/ffdnet-color-v1.onnx', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'irVersion': 9, 'opset': 17,
                 'inputs': {'image': {'shape': [1, 3, 160, 160], 'dtype': 'float32', 'domain': 'RGB sRGB [0,1]'}, 'sigma': {'shape': [1, 1, 1, 1], 'dtype': 'float32', 'domain': 'noise standard deviation /255'}},
                 'output': {'name': 'denoised', 'shape': [1, 3, 160, 160], 'dtype': 'float32', 'domain': 'direct clean RGB sRGB, not residual'},
                 'operators': ['Reshape', 'Transpose', 'Expand', 'Concat', 'Conv', 'Relu', 'DepthToSpace']},
        'architecture': {'convolutionLayers': 12, 'hiddenChannels': 96, 'scale': 2, 'learnedParameters': sum(array.size for array in weights.values()), 'weightsModified': False},
        'conversion': {'script': 'scripts/export-denoise-model.py', 'tool': 'onnx ' + onnx.__version__, 'torchRequired': False, 'checker': 'passed', 'reference': reference, 'deterministicReexport': 'passed; repeated graph build produces identical bytes'},
        'inferenceGuidance': {'tileSize': 160, 'halo': 32, 'validCore': 96, 'pixelPhase': 'Tile origins and halo must remain even to preserve pixel-unshuffle phase', 'receptiveField': '12 low-resolution 3x3 convolutions: radius24 full-resolution pixels plus pixel phase; halo32 covers it', 'boundary': 'Replicate image boundaries in the caller; this differs from zero-filled convolutions at the outer edge of a whole-image evaluation'},
        'limitations': ['Post-development SDR RGB denoising; not a camera-RAW sensor denoiser or Adobe model', 'Trained clipped Gaussian-noise model; real camera noise and detail preservation require scene-level validation', 'No AI source image is uploaded by the model itself'],
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'model': str(args.output), 'bytes': len(data), 'sha256': manifest['onnx']['sha256'], 'validation': reference}, indent=2))


if __name__ == '__main__':
    main()
