"""
Input validation shared by the routers.

The frontend runs an equivalent check (frontend/src/lib/nameValidation.ts) for
instant feedback, but it is only a convenience: anyone can call the API
directly. This module is the check that actually counts.
"""
import re
import unicodedata

NAME_ERROR = "Name can only contain letters and spaces."

_MULTIPLE_SPACES = re.compile(r" {2,}")


def normalize_person_name(value: str) -> str:
    """
    Returns the name cleaned up, or raises ValueError if it is not acceptable.

    Accepted: letters from any alphabet (Unicode categories L*) plus the
    combining marks that go with them (M*), and single spaces between words.
    Combining marks are allowed because many scripts -- Devanagari, Gurmukhi,
    Bengali, and accented Latin written in decomposed form -- write a single
    letter as a base character plus a mark. Rejecting them would lock out
    legitimate names, not just junk.

    Rejected: digits, underscores, hyphens, apostrophes, punctuation, symbols,
    emoji, and control or non-space whitespace characters (tabs, newlines,
    non-breaking spaces).

    Leading/trailing spaces are trimmed and runs of spaces collapse to one.
    """
    # NFC so a name typed as "e" + combining accent and the same name typed as
    # a single precomposed character are stored identically.
    name = unicodedata.normalize("NFC", value).strip(" ")

    if not name:
        raise ValueError("Enter your full name.")

    for char in name:
        if char == " ":
            continue
        if unicodedata.category(char)[0] not in ("L", "M"):
            raise ValueError(NAME_ERROR)

    name = _MULTIPLE_SPACES.sub(" ", name)

    # Every word must start with a real letter, so a name made only of
    # combining marks (which are invisible on their own) cannot get through.
    if any(unicodedata.category(word[0])[0] != "L" for word in name.split(" ")):
        raise ValueError(NAME_ERROR)

    return name
