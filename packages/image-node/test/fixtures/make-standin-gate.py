"""Builds standin-gate.onnx: a tiny ONNX model shaped like the photo gate's image encoder
(input "pixel_values" float32 [1, 3, 224, 224], output "image_embeds" float32 [1, 512]).
The first three output values are the mean of the red, green and blue channels; the other 509
are zero. Lets the gate be tested without downloading the real 176 MB encoder.

Usage: PYTHONPATH=<dir with onnx> python3 make-standin-gate.py
"""

import os

import onnx
from onnx import TensorProto, helper

inp = helper.make_tensor_value_info("pixel_values", TensorProto.FLOAT, [1, 3, 224, 224])
out = helper.make_tensor_value_info("image_embeds", TensorProto.FLOAT, [1, 512])
rd_axes = helper.make_tensor("rd_axes", TensorProto.INT64, [2], [2, 3])
pads = helper.make_tensor("pads", TensorProto.INT64, [4], [0, 0, 0, 509])
nodes = [
    helper.make_node("ReduceMean", ["pixel_values", "rd_axes"], ["rgb"], keepdims=0),
    helper.make_node("Pad", ["rgb", "pads"], ["image_embeds"]),
]
graph = helper.make_graph(nodes, "standin-gate", [inp], [out], initializer=[rd_axes, pads])
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)], producer_name="is-it-real-tests")
model.ir_version = 9
onnx.checker.check_model(model)
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "standin-gate.onnx")
onnx.save(model, path)
print(f"wrote {path} ({os.path.getsize(path)} bytes)")
