### DAG Pipeline Config Prompt

You are configuring a DAG-based execution pipeline for agent workflows. Each node in the DAG represents a task, agent, validator, or webhook. Define the structure, sequence, and configuration of each step to optimize execution flow.

**Example Node**
```json
{
  "id": "score-signals",
  "type": "agent",
  "config": {
    "model": "phoenix",
    "signalThreshold": 0.8
  },
  "dependsOn": ["fetch-signals"]
}
```

Ensure the DAG is acyclic and that all dependencies refer to valid node IDs.
