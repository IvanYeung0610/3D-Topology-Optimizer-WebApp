"""
Pure NumPy SIMP Topology Optimization (no PyTorch required).
Simple implementation for density-based topology optimization.
"""

import numpy as np


class DensityFilter:
    """Density filter to prevent checkerboard patterns."""

    def __init__(self, nodes, elems, radius=1.5):
        """
        Initialize filter with connectivity information.

        The radius is interpreted in element-width units rather than raw
        geometry units so the same value behaves consistently across meshes.
        """
        self.nodes = nodes
        self.elems = elems
        self.radius = max(float(radius), 1.05)
        self.n_elem = len(elems)

        self.elem_centers = np.mean(nodes[elems], axis=1)
        self.elem_centers_scaled = self.elem_centers / self._estimate_element_spacing()
        self._compute_weights()

    def _estimate_element_spacing(self):
        """Estimate structured mesh spacing along each axis."""
        spacing = []
        for axis in range(3):
            coords = np.unique(self.nodes[:, axis])
            if len(coords) <= 1:
                spacing.append(1.0)
                continue

            diffs = np.diff(np.sort(coords))
            positive_diffs = diffs[diffs > 1e-12]
            spacing.append(float(np.min(positive_diffs)) if len(positive_diffs) else 1.0)

        return np.array(spacing, dtype=np.float64)

    def _compute_weights(self):
        """Precompute filter weights."""
        self.H = np.zeros((self.n_elem, self.n_elem))
        self.H_sum = np.zeros(self.n_elem)

        for i in range(self.n_elem):
            for j in range(self.n_elem):
                dist = np.linalg.norm(self.elem_centers_scaled[i] - self.elem_centers_scaled[j])
                if dist < self.radius:
                    weight = self.radius - dist
                    self.H[i, j] = weight
                    self.H_sum[i] += weight

    def apply(self, density):
        """Apply density filter."""
        filtered = np.zeros_like(density)
        for i in range(self.n_elem):
            if self.H_sum[i] > 0:
                filtered[i] = np.sum(self.H[i, :] * density) / self.H_sum[i]
            else:
                filtered[i] = density[i]
        return filtered


class SIMPOptimizer:
    """Pure NumPy SIMP topology optimizer."""

    def __init__(
        self, fem_solver, initial_density=0.5, volume_fraction=0.3, penalty=3.0, filter_radius=1.5
    ):
        """Initialize optimizer."""
        self.fem_solver = fem_solver
        self.n_elem = fem_solver.n_elems
        self.density = np.ones(self.n_elem) * initial_density
        self.volume_fraction = volume_fraction
        self.penalty = penalty
        self.filter = DensityFilter(fem_solver.nodes_np, fem_solver.elems_t, filter_radius)

        self.fixed_dofs_saved = fem_solver.fixed_dofs.copy()
        self.F_global_saved = fem_solver.F_global.copy()
        self.history = {
            "compliance": [],
            "volume": [],
            "density_change": [],
            "iteration": [],
        }

    def update_density(self, sensitivities):
        """
        Update densities using the Optimality Criteria method with adaptive
        Lagrange-multiplier bracketing.
        """
        V_max = self.volume_fraction * self.n_elem
        move_limit = 0.2
        tol = 1e-3
        max_iter = 100

        def candidate_density(lam_value):
            safe_sens = np.where(sensitivities < 0, sensitivities, -1e-10)
            oc_factor = self.density * np.sqrt(-safe_sens / lam_value)
            density_trial = np.maximum(
                0.0,
                np.maximum(
                    self.density - move_limit,
                    np.minimum(
                        1.0,
                        np.minimum(self.density + move_limit, oc_factor),
                    ),
                ),
            )
            return self.filter.apply(density_trial)

        lam_low = 0.0
        lam_high = 1.0

        for _ in range(60):
            density_trial = candidate_density(lam_high)
            if np.sum(density_trial) <= V_max:
                break
            lam_high *= 10.0

        density_new = self.density.copy()
        for _ in range(max_iter):
            lam_mid = lam_high / 2.0 if lam_low == 0.0 else np.sqrt(lam_low * lam_high)
            density_new = candidate_density(lam_mid)
            volume_error = np.sum(density_new) - V_max

            if abs(volume_error) < tol * V_max:
                break

            if volume_error > 0:
                lam_low = lam_mid
            else:
                lam_high = lam_mid

        return density_new

    def optimize(self, n_iterations=50, verbose=True):
        """Run topology optimization."""
        for iteration in range(n_iterations):
            results = self.fem_solver.solve(self.density)
            compliance = results["compliance"]
            sensitivities = results["sensitivities"]

            density_new = self.update_density(sensitivities)
            density_change = np.max(np.abs(density_new - self.density))
            self.density = density_new

            volume = np.sum(self.density) / self.n_elem
            self.history["compliance"].append(compliance)
            self.history["volume"].append(volume)
            self.history["density_change"].append(density_change)
            self.history["iteration"].append(iteration)

            if verbose:
                print(
                    f"  Iter {iteration:2d} | C: {compliance:.6e} | V: {volume:.4f} | dRhoMax: {density_change:.6e}"
                )

        return {
            "density": self.density,
            "final_compliance": self.history["compliance"][-1],
            "final_volume": self.history["volume"][-1],
            "history": self.history,
        }
