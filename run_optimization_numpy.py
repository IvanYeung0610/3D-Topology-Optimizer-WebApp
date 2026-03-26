#!/usr/bin/env python3
"""
Run the default preset and save visualization files in the current directory.
"""

from pathlib import Path

from optimizer_service import DEFAULT_CONFIG, run_topology_optimization


def main():
    result = run_topology_optimization(DEFAULT_CONFIG, output_dir=Path("."))

    print("\n" + "=" * 80)
    print("OPTIMIZATION COMPLETE")
    print("=" * 80)
    print(f"Nodes: {result['mesh']['nodes']}")
    print(f"Elements: {result['mesh']['elements']}")
    print(f"Final compliance: {result['final_compliance']:.6e}")
    print(f"Final volume: {result['final_volume']:.3f}")
    print(f"Compliance improvement: {result['compliance_improvement_percent']:.1f}%")
    print("Artifacts:")
    print(f"  - {result['artifacts']['images']['convergence']}")
    print(f"  - {result['artifacts']['images']['density_histogram']}")
    for item in result["artifacts"]["images"]["thresholds"]:
        print(f"  - {item['file']}")


if __name__ == "__main__":
    main()
