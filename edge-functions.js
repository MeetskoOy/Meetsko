// Meetskon palvelinfunktioiden (Supabase Edge Functions) osoitteet.
//
// Supabase ajaa funktion oletuksena kutsujaa lähimmällä alueella, ei tietokannan
// alueella. Kaikki kutsut kiinnitetään tietokannan alueelle eu-west-1 (Irlanti), jotta
// tiedot käsitellään EU:ssa myös EU:n ulkopuolelta käytettäessä ja tietokantakyselyt
// pysyvät samalla alueella. Sama alue on palvelimella (_shared/region.ts).
//
// Käyttö: fetch(MeetskoFunctions.url('get-my-profile'), { ... })
// Kalenterivaltuutuksen paluuosoitteisiin (auth-callback) EI lisätä parametria: Entra ei
// salli niissä kyselyparametreja, joten funktio ohjaa itse oikealle alueelle.
(function () {
  var BASE = 'https://nrrhvbxvkizvkcwwglck.supabase.co/functions/v1';
  var REGION = 'eu-west-1';
  window.MeetskoFunctions = {
    region: REGION,
    url: function (name) {
      return BASE + '/' + name + '?forceFunctionRegion=' + REGION;
    },
  };
})();
