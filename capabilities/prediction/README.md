# Prediction functions

A prediction function answers a question with numbers learned from the playbook's own history: a quantity over a grain, one or more periods ahead, for one series at a time, as a likely value with a low and a high. Keep the reusable function, the model a version of it holds, and the prediction a run returns distinct. A model is a file in the ONNX format that a trainer builds outside the playbook from the rows the playbook assembles; the playbook scores the candidates against its baselines on held-back periods, runs the winner in shadow, and activates it under the definition's rule. [Decision 0012](../../docs/decisions/0012-prediction-functions.md) records the design.

Planned; this directory holds no implementation yet. See [Functions and availability](../../docs/concepts/functions.md#availability) and [Playbook terminology](../../docs/concepts/terminology.md).
