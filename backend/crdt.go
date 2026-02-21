package collab

type PositionID struct {
	SiteID  string
	Counter int
}

func (p PositionID) Less(other PositionID) bool {
	if p.Counter == other.Counter {
		return p.SiteID < other.SiteID
	}
	return p.Counter < other.Counter
}
