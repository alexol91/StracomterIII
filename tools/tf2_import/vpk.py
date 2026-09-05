"""Lector de archivos VPK de Valve, sin dependencias.

Solo lectura y solo lo que hace falta para sacar unos cuantos ficheros: el
formato está documentado y es simple, y traerse una biblioteca entera para
recorrer un árbol de cadenas terminadas en cero no compensa.

Formato (v1 y v2), resumido:

    cabecera: firma 0x55aa1234, versión, tamaño del árbol
              (v2 añade cuatro tamaños más de secciones que aquí se ignoran)
    árbol:    extensión\\0 { ruta\\0 { nombre\\0 entrada } \\0 } \\0
    entrada:  crc(u32) preload(u16) archivo(u16) offset(u32) longitud(u32) 0xffff
              seguido de `preload` bytes de datos incrustados

Los datos viven en `<nombre>_<archivo:03d>.vpk`, salvo si el índice de archivo
es 0x7fff: entonces están en el propio `_dir.vpk`, después del árbol.
"""

from __future__ import annotations

import os
import struct
from typing import Dict, Iterator, Tuple

SIGNATURE = 0x55AA1234
IN_DIR_FILE = 0x7FFF


class VpkError(RuntimeError):
    pass


class VpkEntry:
    __slots__ = ("path", "crc", "archive_index", "offset", "length", "preload")

    def __init__(self, path: str, crc: int, archive_index: int, offset: int,
                 length: int, preload: bytes) -> None:
        self.path = path
        self.crc = crc
        self.archive_index = archive_index
        self.offset = offset
        self.length = length
        self.preload = preload

    def __repr__(self) -> str:  # pragma: no cover - solo para depurar
        return f"VpkEntry({self.path!r}, {self.length + len(self.preload)} bytes)"


def _read_cstring(data: bytes, pos: int) -> Tuple[str, int]:
    end = data.index(b"\x00", pos)
    return data[pos:end].decode("utf-8", "replace"), end + 1


class Vpk:
    """Un `_dir.vpk` abierto, con su árbol ya leído."""

    def __init__(self, dir_path: str) -> None:
        if not dir_path.endswith("_dir.vpk"):
            raise VpkError(f"se esperaba un fichero _dir.vpk, no {dir_path!r}")
        self.dir_path = dir_path
        self._prefix = dir_path[: -len("_dir.vpk")]
        self.entries: Dict[str, VpkEntry] = {}
        self._data_offset = 0
        self._read_tree()

    def _read_tree(self) -> None:
        with open(self.dir_path, "rb") as handle:
            head = handle.read(12)
            if len(head) < 12:
                raise VpkError("cabecera incompleta")
            signature, version, tree_size = struct.unpack("<III", head)
            if signature != SIGNATURE:
                raise VpkError("no es un VPK (firma incorrecta)")
            if version == 2:
                handle.read(16)  # cuatro tamaños de sección que no hacen falta
            elif version != 1:
                raise VpkError(f"versión de VPK no soportada: {version}")
            self._data_offset = handle.tell() + tree_size
            tree = handle.read(tree_size)

        pos = 0
        while True:
            extension, pos = _read_cstring(tree, pos)
            if extension == "":
                break
            while True:
                folder, pos = _read_cstring(tree, pos)
                if folder == "":
                    break
                while True:
                    name, pos = _read_cstring(tree, pos)
                    if name == "":
                        break
                    crc, preload_len, archive_index, offset, length, terminator = \
                        struct.unpack_from("<IHHIIH", tree, pos)
                    pos += 18
                    if terminator != 0xFFFF:
                        raise VpkError(f"entrada mal terminada en {name!r}")
                    preload = tree[pos:pos + preload_len]
                    pos += preload_len
                    parts = [] if folder in ("", " ") else [folder]
                    full = "/".join(parts + [f"{name}.{extension}"])
                    self.entries[full.lower()] = VpkEntry(
                        full, crc, archive_index, offset, length, preload)

    def __contains__(self, path: str) -> bool:
        return path.lower().replace("\\", "/") in self.entries

    def __len__(self) -> int:
        return len(self.entries)

    def paths(self) -> Iterator[str]:
        for entry in self.entries.values():
            yield entry.path

    def read(self, path: str) -> bytes:
        key = path.lower().replace("\\", "/")
        entry = self.entries.get(key)
        if entry is None:
            raise KeyError(path)
        if entry.length == 0:
            return entry.preload
        if entry.archive_index == IN_DIR_FILE:
            source = self.dir_path
            offset = self._data_offset + entry.offset
        else:
            source = f"{self._prefix}_{entry.archive_index:03d}.vpk"
            offset = entry.offset
        if not os.path.exists(source):
            raise VpkError(f"falta el archivo de datos {source}")
        with open(source, "rb") as handle:
            handle.seek(offset)
            chunk = handle.read(entry.length)
        if len(chunk) != entry.length:
            raise VpkError(f"lectura corta en {path!r}")
        return entry.preload + chunk
