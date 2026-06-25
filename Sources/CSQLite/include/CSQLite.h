#ifndef CSQLITE_H
#define CSQLITE_H

// Expose the system SQLite C API to Swift as the `CSQLite` module. The system
// library is linked via the target's `linkedLibrary("sqlite3")` setting.
#include <sqlite3.h>

#endif /* CSQLITE_H */
