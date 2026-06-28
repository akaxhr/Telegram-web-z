export const aiComposeRoutes = {
  async "aicompose.getTones"(payload, options) {
    console.log("AI COMPOSE GET TONES", payload);

    return {
      hash: 0,
      tones: [],
    };
  },
};