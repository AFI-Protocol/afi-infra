## 🧠 Signal Feedback Schema

The `SignalFeedbackSchema` captures post-signal evaluations for improving agent training, scoring logic, and strategy refinement.

### Purpose
- Used for retrospective scoring and learning loops.
- Enables validators, users, or other agents to submit reactions to previously issued signals.

### Schema Fields
- `signalId`: ID of the signal being evaluated.
- `feedbackType`: Type of feedback ("positive", "negative", or "neutral").
- `reason`: (Optional) Explanation or reasoning.
- `timestamp`: Time feedback was submitted.
- `givenBy`: (Optional) Agent or user submitting the feedback.

### Notes
- This schema feeds directly into signal retrospective analysis workflows.
