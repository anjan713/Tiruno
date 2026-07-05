"""Retrieval-augmented "next-best-material" layer (embeddings + vector index)."""

from .embeddings import EMBED_DIM, embed, embed_batch, embedding_provider, local_embed
from .vector import ensure_vector_index, index_material, search_materials

__all__ = [
    "EMBED_DIM",
    "embed",
    "embed_batch",
    "embedding_provider",
    "local_embed",
    "ensure_vector_index",
    "index_material",
    "search_materials",
]
