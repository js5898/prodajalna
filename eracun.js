//Priprava knjižnic
var formidable = require("formidable");
var util = require('util');

if (!process.env.PORT)
  process.env.PORT = 8080;

// Priprava povezave na podatkovno bazo
var sqlite3 = require('sqlite3').verbose();
var pb = new sqlite3.Database('chinook.sl3');

// Priprava strežnika
var express = require('express');
var expressSession = require('express-session');
var streznik = express();
streznik.set('view engine', 'ejs');
streznik.use(express.static('public'));
streznik.use(
  expressSession({
    secret: '1234567890QWERTY', // Skrivni ključ za podpisovanje piškotkov
    saveUninitialized: true,    // Novo sejo shranimo
    resave: false,              // Ne zahtevamo ponovnega shranjevanja
    cookie: {
      maxAge: 3600000           // Seja poteče po 60min neaktivnosti
    }
  })
);

var razmerje_usd_eur = 0.877039116;

function davcnaStopnja(izvajalec, zanr) {
  switch (izvajalec) {
    case "Queen": case "Led Zepplin": case "Kiss":
      return 0;
    case "Justin Bieber":
      return 22;
    default:
      break;
  }
  switch (zanr) {
    case "Metal": case "Heavy Metal": case "Easy Listening":
      return 0;
    default:
      return 9.5;
  }
}



// Prikaz seznama pesmi na strani
streznik.get('/', function(zahteva, odgovor) {
  if(userSelected == null){
    odgovor.redirect('/prijava');
    
  } else {
  
  pb.all("SELECT Track.TrackId AS id, Track.Name AS pesem, \
          Artist.Name AS izvajalec, Track.UnitPrice * " +
          razmerje_usd_eur + " AS cena, \
          COUNT(InvoiceLine.InvoiceId) AS steviloProdaj, \
          Genre.Name AS zanr \
          FROM Track, Album, Artist, InvoiceLine, Genre \
          WHERE Track.AlbumId = Album.AlbumId AND \
          Artist.ArtistId = Album.ArtistId AND \
          InvoiceLine.TrackId = Track.TrackId AND \
          Track.GenreId = Genre.GenreId \
          GROUP BY Track.TrackId \
          ORDER BY steviloProdaj DESC, pesem ASC \
          LIMIT 100", function(napaka, vrstice) {
    if (napaka)
      odgovor.sendStatus(500);
    else {
        for (var i=0; i<vrstice.length; i++)
          vrstice[i].stopnja = davcnaStopnja(vrstice[i].izvajalec, vrstice[i].zanr);
        odgovor.render('seznam', {seznamPesmi: vrstice});
      }
  })}
})

// Dodajanje oz. brisanje pesmi iz košarice
streznik.get('/kosarica/:idPesmi', function(zahteva, odgovor) {
  var idPesmi = parseInt(zahteva.params.idPesmi);
  if (!zahteva.session.kosarica)
    zahteva.session.kosarica = [];
  if (zahteva.session.kosarica.indexOf(idPesmi) > -1) {
    zahteva.session.kosarica.splice(zahteva.session.kosarica.indexOf(idPesmi), 1);
  } else {
    zahteva.session.kosarica.push(idPesmi);
  }
  
  odgovor.send(zahteva.session.kosarica);
});

// Vrni podrobnosti pesmi v košarici iz podatkovne baze
var pesmiIzKosarice = function(zahteva, callback) {
  if (!zahteva.session.kosarica || Object.keys(zahteva.session.kosarica).length == 0) {
    callback([]);
  } else {
    pb.all("SELECT Track.TrackId AS stevilkaArtikla, 1 AS kolicina, \
    Track.Name || ' (' || Artist.Name || ')' AS opisArtikla, \
    Track.UnitPrice * " + razmerje_usd_eur + " AS cena, 0 AS popust, \
    Genre.Name AS zanr \
    FROM Track, Album, Artist, Genre \
    WHERE Track.AlbumId = Album.AlbumId AND \
    Artist.ArtistId = Album.ArtistId AND \
    Track.GenreId = Genre.GenreId AND \
    Track.TrackId IN (" + zahteva.session.kosarica.join(",") + ")",
    function(napaka, vrstice) {
      if (napaka) {
        callback(false);
      } else {
        for (var i=0; i<vrstice.length; i++) {
          vrstice[i].stopnja = davcnaStopnja((vrstice[i].opisArtikla.split(' (')[1]).split(')')[0], vrstice[i].zanr);
        }
        callback(vrstice);
      }
    })
  }
}

streznik.get('/kosarica', function(zahteva, odgovor) {
  pesmiIzKosarice(zahteva, function(pesmi) {
    if (!pesmi)
      odgovor.sendStatus(500);
    else
      odgovor.send(pesmi);
  });
})

// Vrni podrobnosti pesmi na računu
var pesmiIzRacuna = function(racunId, callback) {
    pb.all("SELECT Track.TrackId AS stevilkaArtikla, 1 AS kolicina, \
    Track.Name || ' (' || Artist.Name || ')' AS opisArtikla, \
    Track.UnitPrice * " + razmerje_usd_eur + " AS cena, 0 AS popust, \
    Genre.Name AS zanr \
    FROM Track, Album, Artist, Genre \
    WHERE Track.AlbumId = Album.AlbumId AND \
    Artist.ArtistId = Album.ArtistId AND \
    Track.GenreId = Genre.GenreId AND \
    Track.TrackId IN (SELECT InvoiceLine.TrackId FROM InvoiceLine, Invoice \
    WHERE InvoiceLine.InvoiceId = Invoice.InvoiceId AND Invoice.InvoiceId = " + racunId + ")",
    
    function(napaka, vrstice) {
      if(!napaka){
        callback(vrstice);
      } else {
        callback(null);
      }
    })
}




// Vrni podrobnosti o stranki iz računa
var strankaIzRacuna = function(racunId, callback) {
    pb.all("SELECT Customer.* FROM Customer, Invoice \
            WHERE Customer.CustomerId = Invoice.CustomerId AND Invoice.InvoiceId = " + racunId,
    function(napaka, vrstice) {
      if(!napaka){
        callback(vrstice[0]);
      } else {
        callback(null);
      }
    })
}



// Vrne stranko glede na njen ID
var strankaIzIDja = function(callback){
  pb.all("SELECT * FROM Customer \
          WHERE Customer.CustomerId = " + globalIDstranke,
  function(napaka, stranka) {
    //console.log(stranka.FirstName);
     if(!napaka && stranka != null){
       callback(napaka, stranka[0]);
     } else {
       callback(null);
     }
  });
}


// Izpis računa v HTML predstavitvi na podlagi podatkov iz baze
streznik.post('/izpisiRacunBaza', function(zahteva, odgovor) {
  
  var izpisRacuna = new formidable.IncomingForm();
  var strankaSave = null;
  var pesmiSave = null;
  var flowError = false;
  
  // Copy iz Readme.mb formidable
  izpisRacuna.parse(zahteva, function(err, fields, files) {
      //res.writeHead(200, {'content-type': 'text/plain'});
      //res.write('received upload:\n\n');
      //res.end(util.inspect({fields: fields, files: files}));
    
    //console.log("fields.seznamRacunov: " + fields.seznamRacunov);
    var IDracuna = fields.seznamRacunov;
    
    strankaIzRacuna(IDracuna, function(stranka){
      //console.log("test");
      //console.log("fields.imePriimek: " + stranka.FirstName +" "+stranka.LastName );
      
      if(stranka){
        // console.log("test2 true");
         strankaSave = stranka;
         //console.log("strankaSave: "+ strankaSave.FirstName);
      } else {
         flowError = true;
      }
      
      if(!flowError){
        pesmiIzRacuna(IDracuna, function(pesmi){
          //console.log("test2");
          
          if(pesmi){
            //console.log("test2 true");
            pesmiSave = pesmi;
            
            for(var i in pesmiSave){
              pesmiSave[i].stopnja = davcnaStopnja(pesmiSave[i].opisArtikla, pesmiSave[i].zanr);
            }
            
          } else {
            flowError = true;
          }
          
          if(!flowError){
              //console.log("test3 true");
              odgovor.setHeader('content-type', 'text/xml');
              odgovor.render('eslog', {
              vizualiziraj: true,
              trenutnaStranka: strankaSave,
              postavkeRacuna: pesmiSave
            })
          }
          });
        } 
        
        if(flowError) {
          odgovor.send("Napaka pri izpisu računa iz baze");
        }
        
      })
  });
})

// Izpis računa v HTML predstavitvi ali izvorni XML obliki
streznik.get('/izpisiRacun/:oblika', function(zahteva, odgovor) {
  
  // globalIDstranke
  //console.log("globalIDstranke: " + globalIDstranke);
  
  pesmiIzKosarice(zahteva, function(pesmi) {
    if (!pesmi) {
      odgovor.sendStatus(500);
    } else if (pesmi.length == 0) {
      odgovor.send("<p>V košarici nimate nobene pesmi, \
        zato računa ni mogoče pripraviti!</p>");
    } else {
      strankaIzIDja(function (napaka, stranka){
          
         if(stranka != null){ 
            //console.log("stranka.FNLN: " + stranka.FirstName +" "+stranka.LastName);
            // Koda od prej
            odgovor.setHeader('content-type', 'text/xml');
            odgovor.render('eslog', {
            vizualiziraj: zahteva.params.oblika == 'html' ? true : false,
            trenutnaStranka: stranka,
            postavkeRacuna: pesmi
            });
         } else {
           odgovor.send("Uporabnika v bazi ni bilo mogoče najti.");
         }
      });
    }
  });
});

// Privzeto izpiši račun v HTML obliki
streznik.get('/izpisiRacun', function(zahteva, odgovor) {
  odgovor.redirect('/izpisiRacun/html')
})

// Vrni stranke iz podatkovne baze
var vrniStranke = function(callback) {
  pb.all("SELECT * FROM Customer",
    function(napaka, vrstice) {
      callback(napaka, vrstice);
    }
  );
}

// Vrni račune iz podatkovne baze
var vrniRacune = function(callback) {
  pb.all("SELECT Customer.FirstName || ' ' || Customer.LastName || ' (' || Invoice.InvoiceId || ') - ' || date(Invoice.InvoiceDate) AS Naziv, \
          Invoice.InvoiceId \
          FROM Customer, Invoice \
          WHERE Customer.CustomerId = Invoice.CustomerId",
    function(napaka, vrstice) {
      callback(napaka, vrstice);
    }
  );
}

// Registracija novega uporabnika
var success = null;

streznik.post('/prijava', function(zahteva, odgovor) {
  var form = new formidable.IncomingForm();
  
  form.parse(zahteva, function (napaka1, polja, datoteke) {
    var napaka2 = false;
    try {
      var stmt = pb.prepare("\
        INSERT INTO Customer \
    	  (FirstName, LastName, Company, \
    	  Address, City, State, Country, PostalCode, \
    	  Phone, Fax, Email, SupportRepId) \
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
      
      // Fill polj
      stmt.run(polja.FirstName, polja.LastName, polja.Company, polja.Address, polja.City, polja.State, polja.Conutry, polja.PostalCode, polja.Phone, polja.Fax, polja.Email, 3); 
      stmt.finalize();
      //Check uspesnosti registracije - duplikat napake2 zaradi dosega
      success = true;
      //console.log("success = true");
      //console.log("--> Zgoraj Napaka1: " + napaka1 + " Napaka2: " + napaka2 + " Success: " + success);
    } catch (err) {
      napaka2 = true;
      success = false;
    }
    odgovor.redirect('/prijava');
    odgovor.end();
    
  });
})

// Prikaz strani za prijavo
streznik.get('/prijava', function(zahteva, odgovor) {
  
  vrniStranke(function(napaka1, stranke) {
      vrniRacune(function(napaka2, racuni) {
        //console.log("--> Napaka1: " + napaka1 + " Napaka2: " + napaka2 + " Success: " + success);
        
        if(success){
          //console.log("success");
          var message = "Stranka je bila uspesno registrirana.";
          odgovor.render('prijava', {sporocilo : message, seznamStrank: stranke, seznamRacunov: racuni});
          success = null;
          
        } else if (!success && (success != null)) {
          //console.log("success=false");
          var message = "Prišlo je do napake pri registraciji nove stranke. Prosim preverite vnešene podatke in poskusite znova.";
          odgovor.render('prijava', {sporocilo : message, seznamStrank: stranke, seznamRacunov: racuni});
          success = null;
          
        } else {
          //console.log("else");
          var message = "";
          odgovor.render('prijava', {sporocilo: message, seznamStrank: stranke, seznamRacunov: racuni});
        }
      }) 
    });
})

var userSelected = null;
var globalIDstranke = null;

// Prikaz nakupovalne košarice za stranko
streznik.post('/stranka', function(zahteva, odgovor) {
  var form = new formidable.IncomingForm();
  
  form.parse(zahteva, function (napaka1, polja, datoteke) {

    userSelected = true;

    
    globalIDstranke = polja.seznamStrank;
    //console.log("ID: "+ globalIDstranke);
    odgovor.redirect('/');
  });
})

// Odjava stranke
streznik.post('/odjava', function(zahteva, odgovor) {
    userSelected = null;
    console.log("Odjava success");
    odgovor.redirect('/prijava');
})



streznik.listen(process.env.PORT, function() {
  console.log("Strežnik pognan!");
})
