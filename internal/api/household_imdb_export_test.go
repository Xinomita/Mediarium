package api

import "github.com/rdborg/mediarium/internal/imdb"

func (s *Server) TestUseHouseholdIMDb(store *imdb.Store) { s.householdIMDb = store }
