"""Builds standin-classifier.onnx: a tiny ONNX model shaped like the real image classifiers
(input "pixel_values" float32 [1, 3, 384, 384], output "logits" float32 [1, 1]) whose logit is
4 * mean(red channel). Lets the runner be tested without downloading a real model.

Usage: PYTHONPATH=<dir with onnx> python3 make-standin-model.py
"""

import os

import onnx
from onnx import TensorProto, helper

inp = helper.make_tensor_value_info("pixel_values", TensorProto.FLOAT, [1, 3, 384, 384])
out = helper.make_tensor_value_info("logits", TensorProto.FLOAT, [1, 1])
starts = helper.make_tensor("starts", TensorProto.INT64, [1], [0])
ends = helper.make_tensor("ends", TensorProto.INT64, [1], [1])
axes = helper.make_tensor("axes", TensorProto.INT64, [1], [1])
rd_axes = helper.make_tensor("rd_axes", TensorProto.INT64, [3], [1, 2, 3])
four = helper.make_tensor("four", TensorProto.FLOAT, [], [4.0])
nodes = [
    helper.make_node("Slice", ["pixel_values", "starts", "ends", "axes"], ["red"]),
    helper.make_node("ReduceMean", ["red", "rd_axes"], ["m"], keepdims=0),
    helper.make_node("Mul", ["m", "four"], ["m4"]),
    helper.make_node("Unsqueeze", ["m4", "axes"], ["logits"]),
]
graph = helper.make_graph(nodes, "standin", [inp], [out], initializer=[starts, ends, axes, rd_axes, four])
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)], producer_name="is-it-real-tests")
model.ir_version = 9
onnx.checker.check_model(model)
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "standin-classifier.onnx")
onnx.save(model, path)
print(f"wrote {path} ({os.path.getsize(path)} bytes)")
