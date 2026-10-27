"""Genome interval utilities using 0-based, half-open coordinates."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, order=True)
class Interval:
    chrom: str
    start: int
    end: int

    def __post_init__(self) -> None:
        if not self.chrom:
            raise ValueError("chromosome is required")
        if self.start < 0 or self.end <= self.start:
            raise ValueError(f"invalid half-open interval: {self.chrom}:{self.start}-{self.end}")

    @property
    def midpoint(self) -> int:
        return (self.start + self.end) // 2

    def overlaps(self, other: "Interval") -> bool:
        return self.chrom == other.chrom and self.start < other.end and other.start < self.end

    def distance_to_point(self, point: int) -> int:
        """Minimum distance in bp; a point inside the interval has distance zero."""
        if self.start <= point < self.end:
            return 0
        return self.start - point if point < self.start else point - self.end + 1


def tss(start: int, end: int, strand: str) -> int:
    if strand == "+":
        return start
    if strand == "-":
        return end - 1
    raise ValueError("gene strand must be '+' or '-'")


def signed_relative_position(enhancer_midpoint: int, gene_tss: int, strand: str) -> int:
    """Signed enhancer position in the gene's transcriptional orientation."""
    if strand not in {"+", "-"}:
        raise ValueError("gene strand must be '+' or '-'")
    genomic_offset = enhancer_midpoint - gene_tss
    return genomic_offset if strand == "+" else -genomic_offset
