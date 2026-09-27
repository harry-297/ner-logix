export const roadRiskData = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        id: "road-001",
        name: "Demo Corridor A",
        riskScore: 22,
        riskLevel: "LOW",
        status: "Accessible",
        expectedDelay: "10 min",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [91.70, 26.15],
          [91.90, 26.25],
          [92.15, 26.35],
        ],
      },
    },

    {
      type: "Feature",
      properties: {
        id: "road-002",
        name: "Demo Corridor B",
        riskScore: 48,
        riskLevel: "MODERATE",
        status: "Accessible with caution",
        expectedDelay: "35 min",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [92.00, 26.20],
          [92.25, 26.45],
          [92.50, 26.65],
        ],
      },
    },

    {
      type: "Feature",
      properties: {
        id: "road-003",
        name: "Demo Corridor C",
        riskScore: 67,
        riskLevel: "HIGH",
        status: "Restricted",
        expectedDelay: "1 hr 40 min",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [92.80, 26.75],
          [93.05, 26.95],
          [93.30, 27.15],
        ],
      },
    },

    {
      type: "Feature",
      properties: {
        id: "road-004",
        name: "Demo Corridor D",
        riskScore: 84,
        riskLevel: "CRITICAL",
        status: "Severe disruption risk",
        expectedDelay: "3 hr 20 min",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [93.60, 27.25],
          [93.85, 27.45],
          [94.10, 27.65],
        ],
      },
    },

    {
      type: "Feature",
      properties: {
        id: "road-005",
        name: "Demo Corridor E",
        riskScore: 94,
        riskLevel: "BLOCKED",
        status: "Blocked",
        expectedDelay: "Unknown",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [94.20, 26.90],
          [94.45, 27.10],
          [94.70, 27.30],
        ],
      },
    },
  ],
} as const;