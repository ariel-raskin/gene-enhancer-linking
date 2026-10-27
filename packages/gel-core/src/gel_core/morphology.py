"""Descriptive strand geometry for nascent-transcription candidate loci."""

from __future__ import annotations

import math


def classify_strand_geometry(minus_left: float, plus_left: float,
                             minus_right: float, plus_right: float,
                             min_total: float = 4.0,
                             dominant_fraction: float = 0.65,
                             balance_floor: float = 0.15) -> str:
    """Classify outward/divergent and inward/convergent signal around an interval.

    Inputs are non-negative signal magnitudes. In the outward geometry, minus
    signal is left of the center and plus signal is right of it.
    """
    values = (minus_left, plus_left, minus_right, plus_right)
    if any(not math.isfinite(value) or value < 0 for value in values):
        raise ValueError("strand signal must be finite and non-negative")
    outward = minus_left + plus_right
    inward = plus_left + minus_right
    total = outward + inward
    if total < min_total:
        return "low_signal_ambiguous"
    if outward / total >= dominant_fraction:
        balance = min(minus_left, plus_right) / max(minus_left, plus_right, 1e-12)
        return "unidirectional_outward_candidate" if balance < balance_floor else (
            "divergent_outward" if balance >= 1.0 - balance_floor else "asymmetric_divergent"
        )
    if inward / total >= dominant_fraction:
        balance = min(plus_left, minus_right) / max(plus_left, minus_right, 1e-12)
        return "unidirectional_or_readthrough" if balance < balance_floor else "convergent_inward"
    # A single strand spanning both flanks is more consistent with
    # unidirectional transcription/read-through than divergent initiation.
    if max(plus_left + plus_right, minus_left + minus_right) / total >= 0.85:
        return "unidirectional_or_readthrough"
    return "bidirectional_mixed_geometry" if min(outward, inward) / total >= balance_floor else "asymmetric_uncertain"
