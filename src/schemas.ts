// GENERATED from openapi.json — do not edit by hand.
//
// Per-route invocation contracts published inside the x402 402 challenge as
// `accepts[].outputSchema`. `input` tells an agent how to build the request
// (method, query/path params, JSON body fields); `output` is the JSON Schema of
// the 200 body it gets back once payment settles.
//
// Deriving these from `openapi.json` keeps the runtime challenge — which the
// x402scan discovery spec treats as authoritative — from ever contradicting the
// published spec. Regenerate whenever a paid route's parameters or response
// schema change.
//
// Keys match the paywall route map in `server.ts` exactly (`"<METHOD> <path>"`,
// with `:param` for path segments).

import type { RouteSchema } from "./payments.js";

export const ROUTE_SCHEMAS: Record<string, RouteSchema> = {
  "POST /offers": {
    "input": {
      "type": "http",
      "method": "POST",
      "bodyType": "json",
      "bodyFields": {
        "from": {
          "type": "string",
          "description": "Your agent/party identifier.",
          "x-required": true
        },
        "fromSide": {
          "type": "string",
          "enum": [
            "buyer",
            "seller"
          ],
          "x-required": true
        },
        "to": {
          "type": "string",
          "description": "Counterparty identifier.",
          "x-required": true
        },
        "item": {
          "type": "string",
          "maxLength": 200,
          "x-required": true
        },
        "quantity": {
          "type": "number",
          "default": 1
        },
        "unitPriceUsd": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 1000000,
          "x-required": true
        },
        "terms": {
          "type": "object",
          "properties": {
            "delivery": {
              "type": "string"
            },
            "validUntil": {
              "type": "string"
            },
            "settlementRails": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "notes": {
              "type": "string"
            }
          }
        }
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "instrument": {
          "type": "object",
          "description": "A signed negotiation instrument. `payload.prevSignature` and `payload.prevHash` link it to the previous instrument in the thread, forming a verifiable chain.",
          "properties": {
            "payload": {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "offer",
                    "counter",
                    "agreement",
                    "rejection"
                  ]
                },
                "instrumentId": {
                  "type": "string"
                },
                "threadId": {
                  "type": "string"
                },
                "seq": {
                  "type": "integer",
                  "description": "1-based position in the chain."
                },
                "prevSignature": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "prevHash": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "SHA-256 over the canonical JSON of the previous payload."
                },
                "from": {
                  "type": "string"
                },
                "fromSide": {
                  "type": "string",
                  "enum": [
                    "buyer",
                    "seller"
                  ]
                },
                "to": {
                  "type": "string"
                },
                "item": {
                  "type": "string"
                },
                "quantity": {
                  "type": "number"
                },
                "unitPriceUsd": {
                  "type": "number"
                },
                "priceUsd": {
                  "type": "number",
                  "description": "unitPriceUsd \u00d7 quantity."
                },
                "currency": {
                  "type": "string",
                  "const": "USD"
                },
                "terms": {
                  "type": "object",
                  "properties": {
                    "delivery": {
                      "type": "string"
                    },
                    "validUntil": {
                      "type": "string"
                    },
                    "settlementRails": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "notes": {
                      "type": "string"
                    }
                  }
                },
                "issuedAt": {
                  "type": "string"
                },
                "concession": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "description": "Movement analysis. Null on the opening offer.",
                  "properties": {
                    "movedUsd": {
                      "type": "number"
                    },
                    "movedPct": {
                      "type": "number"
                    },
                    "gapUsd": {
                      "type": "number"
                    },
                    "gapPct": {
                      "type": "number"
                    },
                    "totalMoved": {
                      "type": "object",
                      "properties": {
                        "buyer": {
                          "type": "number"
                        },
                        "seller": {
                          "type": "number"
                        }
                      }
                    },
                    "projectedSettleUsd": {
                      "type": [
                        "number",
                        "null"
                      ]
                    },
                    "projectedRounds": {
                      "type": [
                        "integer",
                        "null"
                      ]
                    },
                    "note": {
                      "type": "string"
                    }
                  }
                },
                "settlement": {
                  "type": "object",
                  "description": "Agreements only. What is owed, by whom, on which rails, by when.",
                  "properties": {
                    "agreedPriceUsd": {
                      "type": "number"
                    },
                    "agreedUnitPriceUsd": {
                      "type": "number"
                    },
                    "quantity": {
                      "type": "number"
                    },
                    "payer": {
                      "type": "string"
                    },
                    "payerSide": {
                      "type": "string"
                    },
                    "payee": {
                      "type": "string"
                    },
                    "payeeSide": {
                      "type": "string"
                    },
                    "settlementRails": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "settleBy": {
                      "type": "string"
                    },
                    "openedAtUsd": {
                      "type": "number"
                    },
                    "totalMovementUsd": {
                      "type": "number"
                    },
                    "instructions": {
                      "type": "string"
                    }
                  }
                },
                "reason": {
                  "type": "string",
                  "description": "Rejections only."
                }
              }
            },
            "signature": {
              "type": "string"
            },
            "algorithm": {
              "type": "string",
              "const": "HMAC-SHA256"
            },
            "canonicalization": {
              "type": "string",
              "const": "sorted-json"
            }
          }
        },
        "thread": {
          "type": "object",
          "properties": {
            "threadId": {
              "type": "string"
            },
            "status": {
              "type": "string",
              "enum": [
                "open",
                "agreed",
                "withdrawn",
                "expired"
              ]
            },
            "parties": {
              "type": "object",
              "properties": {
                "buyer": {
                  "type": "string"
                },
                "seller": {
                  "type": "string"
                }
              }
            },
            "seq": {
              "type": "integer"
            }
          }
        },
        "links": {
          "type": "object",
          "properties": {
            "thread": {
              "type": "string"
            },
            "counter": {
              "type": "string"
            },
            "accept": {
              "type": "string"
            }
          }
        },
        "payment": {
          "type": [
            "object",
            "null"
          ],
          "description": "Settlement receipt for this call \u2014 same content as X-PAYMENT-RESPONSE."
        }
      }
    }
  },
  "POST /counter/:offerId": {
    "input": {
      "type": "http",
      "method": "POST",
      "pathParams": {
        "offerId": {
          "type": "string",
          "description": "instrumentId of the LATEST instrument in the thread.",
          "x-required": true
        }
      },
      "bodyType": "json",
      "bodyFields": {
        "from": {
          "type": "string",
          "x-required": true
        },
        "unitPriceUsd": {
          "type": "number",
          "exclusiveMinimum": 0,
          "x-required": true
        },
        "terms": {
          "type": "object"
        }
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "instrument": {
          "type": "object",
          "description": "A signed negotiation instrument. `payload.prevSignature` and `payload.prevHash` link it to the previous instrument in the thread, forming a verifiable chain.",
          "properties": {
            "payload": {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "offer",
                    "counter",
                    "agreement",
                    "rejection"
                  ]
                },
                "instrumentId": {
                  "type": "string"
                },
                "threadId": {
                  "type": "string"
                },
                "seq": {
                  "type": "integer",
                  "description": "1-based position in the chain."
                },
                "prevSignature": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "prevHash": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "SHA-256 over the canonical JSON of the previous payload."
                },
                "from": {
                  "type": "string"
                },
                "fromSide": {
                  "type": "string",
                  "enum": [
                    "buyer",
                    "seller"
                  ]
                },
                "to": {
                  "type": "string"
                },
                "item": {
                  "type": "string"
                },
                "quantity": {
                  "type": "number"
                },
                "unitPriceUsd": {
                  "type": "number"
                },
                "priceUsd": {
                  "type": "number",
                  "description": "unitPriceUsd \u00d7 quantity."
                },
                "currency": {
                  "type": "string",
                  "const": "USD"
                },
                "terms": {
                  "type": "object",
                  "properties": {
                    "delivery": {
                      "type": "string"
                    },
                    "validUntil": {
                      "type": "string"
                    },
                    "settlementRails": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "notes": {
                      "type": "string"
                    }
                  }
                },
                "issuedAt": {
                  "type": "string"
                },
                "concession": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "description": "Movement analysis. Null on the opening offer.",
                  "properties": {
                    "movedUsd": {
                      "type": "number"
                    },
                    "movedPct": {
                      "type": "number"
                    },
                    "gapUsd": {
                      "type": "number"
                    },
                    "gapPct": {
                      "type": "number"
                    },
                    "totalMoved": {
                      "type": "object",
                      "properties": {
                        "buyer": {
                          "type": "number"
                        },
                        "seller": {
                          "type": "number"
                        }
                      }
                    },
                    "projectedSettleUsd": {
                      "type": [
                        "number",
                        "null"
                      ]
                    },
                    "projectedRounds": {
                      "type": [
                        "integer",
                        "null"
                      ]
                    },
                    "note": {
                      "type": "string"
                    }
                  }
                },
                "settlement": {
                  "type": "object",
                  "description": "Agreements only. What is owed, by whom, on which rails, by when.",
                  "properties": {
                    "agreedPriceUsd": {
                      "type": "number"
                    },
                    "agreedUnitPriceUsd": {
                      "type": "number"
                    },
                    "quantity": {
                      "type": "number"
                    },
                    "payer": {
                      "type": "string"
                    },
                    "payerSide": {
                      "type": "string"
                    },
                    "payee": {
                      "type": "string"
                    },
                    "payeeSide": {
                      "type": "string"
                    },
                    "settlementRails": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "settleBy": {
                      "type": "string"
                    },
                    "openedAtUsd": {
                      "type": "number"
                    },
                    "totalMovementUsd": {
                      "type": "number"
                    },
                    "instructions": {
                      "type": "string"
                    }
                  }
                },
                "reason": {
                  "type": "string",
                  "description": "Rejections only."
                }
              }
            },
            "signature": {
              "type": "string"
            },
            "algorithm": {
              "type": "string",
              "const": "HMAC-SHA256"
            },
            "canonicalization": {
              "type": "string",
              "const": "sorted-json"
            }
          }
        },
        "thread": {
          "type": "object",
          "properties": {
            "threadId": {
              "type": "string"
            },
            "status": {
              "type": "string",
              "enum": [
                "open",
                "agreed",
                "withdrawn",
                "expired"
              ]
            },
            "parties": {
              "type": "object",
              "properties": {
                "buyer": {
                  "type": "string"
                },
                "seller": {
                  "type": "string"
                }
              }
            },
            "seq": {
              "type": "integer"
            }
          }
        },
        "links": {
          "type": "object",
          "properties": {
            "thread": {
              "type": "string"
            },
            "counter": {
              "type": "string"
            },
            "accept": {
              "type": "string"
            }
          }
        },
        "payment": {
          "type": [
            "object",
            "null"
          ],
          "description": "Settlement receipt for this call \u2014 same content as X-PAYMENT-RESPONSE."
        }
      }
    }
  },
  "POST /accept/:offerId": {
    "input": {
      "type": "http",
      "method": "POST",
      "pathParams": {
        "offerId": {
          "type": "string",
          "description": "instrumentId of the LATEST instrument, which must not be your own.",
          "x-required": true
        }
      },
      "bodyType": "json",
      "bodyFields": {
        "from": {
          "type": "string",
          "x-required": true
        },
        "settleWithinHours": {
          "type": "number",
          "default": 48,
          "minimum": 1,
          "maximum": 720
        },
        "notes": {
          "type": "string"
        }
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "agreement": {
          "type": "object",
          "description": "A signed negotiation instrument. `payload.prevSignature` and `payload.prevHash` link it to the previous instrument in the thread, forming a verifiable chain.",
          "properties": {
            "payload": {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "offer",
                    "counter",
                    "agreement",
                    "rejection"
                  ]
                },
                "instrumentId": {
                  "type": "string"
                },
                "threadId": {
                  "type": "string"
                },
                "seq": {
                  "type": "integer",
                  "description": "1-based position in the chain."
                },
                "prevSignature": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "prevHash": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "SHA-256 over the canonical JSON of the previous payload."
                },
                "from": {
                  "type": "string"
                },
                "fromSide": {
                  "type": "string",
                  "enum": [
                    "buyer",
                    "seller"
                  ]
                },
                "to": {
                  "type": "string"
                },
                "item": {
                  "type": "string"
                },
                "quantity": {
                  "type": "number"
                },
                "unitPriceUsd": {
                  "type": "number"
                },
                "priceUsd": {
                  "type": "number",
                  "description": "unitPriceUsd \u00d7 quantity."
                },
                "currency": {
                  "type": "string",
                  "const": "USD"
                },
                "terms": {
                  "type": "object",
                  "properties": {
                    "delivery": {
                      "type": "string"
                    },
                    "validUntil": {
                      "type": "string"
                    },
                    "settlementRails": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "notes": {
                      "type": "string"
                    }
                  }
                },
                "issuedAt": {
                  "type": "string"
                },
                "concession": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "description": "Movement analysis. Null on the opening offer.",
                  "properties": {
                    "movedUsd": {
                      "type": "number"
                    },
                    "movedPct": {
                      "type": "number"
                    },
                    "gapUsd": {
                      "type": "number"
                    },
                    "gapPct": {
                      "type": "number"
                    },
                    "totalMoved": {
                      "type": "object",
                      "properties": {
                        "buyer": {
                          "type": "number"
                        },
                        "seller": {
                          "type": "number"
                        }
                      }
                    },
                    "projectedSettleUsd": {
                      "type": [
                        "number",
                        "null"
                      ]
                    },
                    "projectedRounds": {
                      "type": [
                        "integer",
                        "null"
                      ]
                    },
                    "note": {
                      "type": "string"
                    }
                  }
                },
                "settlement": {
                  "type": "object",
                  "description": "Agreements only. What is owed, by whom, on which rails, by when.",
                  "properties": {
                    "agreedPriceUsd": {
                      "type": "number"
                    },
                    "agreedUnitPriceUsd": {
                      "type": "number"
                    },
                    "quantity": {
                      "type": "number"
                    },
                    "payer": {
                      "type": "string"
                    },
                    "payerSide": {
                      "type": "string"
                    },
                    "payee": {
                      "type": "string"
                    },
                    "payeeSide": {
                      "type": "string"
                    },
                    "settlementRails": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "settleBy": {
                      "type": "string"
                    },
                    "openedAtUsd": {
                      "type": "number"
                    },
                    "totalMovementUsd": {
                      "type": "number"
                    },
                    "instructions": {
                      "type": "string"
                    }
                  }
                },
                "reason": {
                  "type": "string",
                  "description": "Rejections only."
                }
              }
            },
            "signature": {
              "type": "string"
            },
            "algorithm": {
              "type": "string",
              "const": "HMAC-SHA256"
            },
            "canonicalization": {
              "type": "string",
              "const": "sorted-json"
            }
          }
        },
        "settlement": {
          "type": "object",
          "description": "Agreements only. What is owed, by whom, on which rails, by when.",
          "properties": {
            "agreedPriceUsd": {
              "type": "number"
            },
            "agreedUnitPriceUsd": {
              "type": "number"
            },
            "quantity": {
              "type": "number"
            },
            "payer": {
              "type": "string"
            },
            "payerSide": {
              "type": "string"
            },
            "payee": {
              "type": "string"
            },
            "payeeSide": {
              "type": "string"
            },
            "settlementRails": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "settleBy": {
              "type": "string"
            },
            "openedAtUsd": {
              "type": "number"
            },
            "totalMovementUsd": {
              "type": "number"
            },
            "instructions": {
              "type": "string"
            }
          }
        },
        "thread": {
          "type": "object",
          "properties": {
            "threadId": {
              "type": "string"
            },
            "status": {
              "type": "string",
              "enum": [
                "open",
                "agreed",
                "withdrawn",
                "expired"
              ]
            },
            "parties": {
              "type": "object",
              "properties": {
                "buyer": {
                  "type": "string"
                },
                "seller": {
                  "type": "string"
                }
              }
            },
            "seq": {
              "type": "integer"
            }
          }
        },
        "chain": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "A signed negotiation instrument. `payload.prevSignature` and `payload.prevHash` link it to the previous instrument in the thread, forming a verifiable chain.",
            "properties": {
              "payload": {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "offer",
                      "counter",
                      "agreement",
                      "rejection"
                    ]
                  },
                  "instrumentId": {
                    "type": "string"
                  },
                  "threadId": {
                    "type": "string"
                  },
                  "seq": {
                    "type": "integer",
                    "description": "1-based position in the chain."
                  },
                  "prevSignature": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "prevHash": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "description": "SHA-256 over the canonical JSON of the previous payload."
                  },
                  "from": {
                    "type": "string"
                  },
                  "fromSide": {
                    "type": "string",
                    "enum": [
                      "buyer",
                      "seller"
                    ]
                  },
                  "to": {
                    "type": "string"
                  },
                  "item": {
                    "type": "string"
                  },
                  "quantity": {
                    "type": "number"
                  },
                  "unitPriceUsd": {
                    "type": "number"
                  },
                  "priceUsd": {
                    "type": "number",
                    "description": "unitPriceUsd \u00d7 quantity."
                  },
                  "currency": {
                    "type": "string",
                    "const": "USD"
                  },
                  "terms": {
                    "type": "object",
                    "properties": {
                      "delivery": {
                        "type": "string"
                      },
                      "validUntil": {
                        "type": "string"
                      },
                      "settlementRails": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      },
                      "notes": {
                        "type": "string"
                      }
                    }
                  },
                  "issuedAt": {
                    "type": "string"
                  },
                  "concession": {
                    "type": [
                      "object",
                      "null"
                    ],
                    "description": "Movement analysis. Null on the opening offer.",
                    "properties": {
                      "movedUsd": {
                        "type": "number"
                      },
                      "movedPct": {
                        "type": "number"
                      },
                      "gapUsd": {
                        "type": "number"
                      },
                      "gapPct": {
                        "type": "number"
                      },
                      "totalMoved": {
                        "type": "object",
                        "properties": {
                          "buyer": {
                            "type": "number"
                          },
                          "seller": {
                            "type": "number"
                          }
                        }
                      },
                      "projectedSettleUsd": {
                        "type": [
                          "number",
                          "null"
                        ]
                      },
                      "projectedRounds": {
                        "type": [
                          "integer",
                          "null"
                        ]
                      },
                      "note": {
                        "type": "string"
                      }
                    }
                  },
                  "settlement": {
                    "type": "object",
                    "description": "Agreements only. What is owed, by whom, on which rails, by when.",
                    "properties": {
                      "agreedPriceUsd": {
                        "type": "number"
                      },
                      "agreedUnitPriceUsd": {
                        "type": "number"
                      },
                      "quantity": {
                        "type": "number"
                      },
                      "payer": {
                        "type": "string"
                      },
                      "payerSide": {
                        "type": "string"
                      },
                      "payee": {
                        "type": "string"
                      },
                      "payeeSide": {
                        "type": "string"
                      },
                      "settlementRails": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      },
                      "settleBy": {
                        "type": "string"
                      },
                      "openedAtUsd": {
                        "type": "number"
                      },
                      "totalMovementUsd": {
                        "type": "number"
                      },
                      "instructions": {
                        "type": "string"
                      }
                    }
                  },
                  "reason": {
                    "type": "string",
                    "description": "Rejections only."
                  }
                }
              },
              "signature": {
                "type": "string"
              },
              "algorithm": {
                "type": "string",
                "const": "HMAC-SHA256"
              },
              "canonicalization": {
                "type": "string",
                "const": "sorted-json"
              }
            }
          }
        },
        "payment": {
          "type": [
            "object",
            "null"
          ],
          "description": "Settlement receipt for this call \u2014 same content as X-PAYMENT-RESPONSE."
        }
      }
    }
  },
};
