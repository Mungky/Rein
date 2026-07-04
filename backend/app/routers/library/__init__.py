"""Digital Library router package.

Endpoint code lives in domain modules; importing a module registers its
routes on the shared APIRouter, so the import order below IS the route
registration order — keep it.
"""

from ._shared import router  # noqa: F401

from . import browse  # noqa: F401
from . import upload_flow  # noqa: F401
from . import view_requests  # noqa: F401
from . import file_ops  # noqa: F401
from . import folder_ops  # noqa: F401
from . import public_meta  # noqa: F401
from . import admin_ops  # noqa: F401
