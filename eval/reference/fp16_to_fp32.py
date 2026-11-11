"""Makes a float32 copy of a float16-weight ONNX model, for faster scoring on CPU during evaluation.

The shipped model stays the float16 file. image_eval.py --parity compares the two copies' outputs
on real images, so the evaluation can show the conversion does not change results materially.
Usage: PYTHONPATH=<onnx> python3 fp16_to_fp32.py in.onnx out.onnx
"""

import sys

import numpy as np
import onnx
from onnx import TensorProto, numpy_helper

src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
for i, init in enumerate(g.initializer):
    if init.data_type == TensorProto.FLOAT16:
        arr = numpy_helper.to_array(init).astype(np.float32)
        g.initializer[i].CopyFrom(numpy_helper.from_array(arr, init.name))
for node in g.node:
    if node.op_type == "Cast":
        for a in node.attribute:
            if a.name == "to" and a.i == TensorProto.FLOAT16:
                a.i = TensorProto.FLOAT
    if node.op_type == "Constant":
        for a in node.attribute:
            if a.name == "value" and a.t.data_type == TensorProto.FLOAT16:
                a.t.CopyFrom(numpy_helper.from_array(numpy_helper.to_array(a.t).astype(np.float32), a.t.name))
for vi in list(g.value_info) + list(g.input) + list(g.output):
    if vi.type.tensor_type.elem_type == TensorProto.FLOAT16:
        vi.type.tensor_type.elem_type = TensorProto.FLOAT
onnx.checker.check_model(m)
onnx.save(m, dst)
print(f"wrote {dst}")
